#![cfg(feature = "sandbox-gas")]

use anyhow::{Result, ensure};
use near_sdk::serde_json::{Value, json};
use near_workspaces::{
    AccessKey, Account, AccountDetailsPatch, Contract, Worker,
    network::Sandbox,
    types::{AccountId, Gas, KeyType, NearToken, SecretKey},
};
use std::path::PathBuf;

async fn invoke(
    account: &Account,
    contract: &Contract,
    method: &str,
    args: Value,
    deposit: u128,
) -> Result<near_workspaces::result::ExecutionFinalResult> {
    let outcome = account
        .call(contract.id(), method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(deposit))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    ensure!(
        outcome.failures().is_empty(),
        "{method} had failed receipts: {:?}",
        outcome.failures()
    );
    Ok(outcome)
}
async fn fixture(
    worker: &Worker<Sandbox>,
    wasm: &[u8],
    role: &str,
    usdc: Option<&AccountId>,
) -> Result<Contract> {
    let contract = worker.dev_deploy(wasm).await?;
    contract
        .call("new")
        .args_json(json!({"role":role,"usdc":usdc.unwrap_or(contract.id())}))
        .transact()
        .await?
        .into_result()?;
    Ok(contract)
}
async fn init_vault(
    root: &Account,
    vault: &Contract,
    token: &Contract,
    rhea: &Contract,
    intents: &Contract,
    treasury: &Account,
    cap: u128,
) -> Result<()> {
    for id in [vault.id(), rhea.id(), intents.id(), treasury.id()] {
        let _ = invoke(root, token, "register", json!({"account_id":id}), 0).await?;
    }
    let _ = invoke(root,vault,"new",json!({"usdc":token.id(),"rhea":rhea.id(),"intents":intents.id(),"treasury":treasury.id(),"cushion":"0","min_deposit":"1000000","cap":cap.to_string()}),0).await?;
    Ok(())
}
async fn deposit(root: &Account, token: &Contract, vault: &Contract, user: &str) -> Result<()> {
    let _ = invoke(
        root,
        token,
        "ft_transfer_call",
        json!({"receiver_id":vault.id(),"amount":"1000000","msg":json!({"user":user}).to_string()}),
        1,
    )
    .await?;
    Ok(())
}
async fn assert_cash(vault: &Contract, token: &Contract, users: &[String]) -> Result<()> {
    ensure!(
        !vault.view("busy").await?.json::<bool>()?,
        "cycle stuck busy"
    );
    let idle = vault
        .view("idle")
        .await?
        .json::<String>()?
        .parse::<u128>()?;
    let cash = token
        .view("ft_balance_of")
        .args_json(json!({"account_id":vault.id()}))
        .await?
        .json::<String>()?
        .parse::<u128>()?;
    let mut pending = 0;
    for user in users {
        pending += vault
            .view("position")
            .args_json(json!({"user":user}))
            .await?
            .json::<Value>()?["pending_in"]
            .as_str()
            .unwrap()
            .parse::<u128>()?;
    }
    ensure!(
        cash == idle + pending,
        "cash reconciliation failed: cash={cash}, idle={idle}, pending={pending}"
    );
    Ok(())
}

#[tokio::test]
async fn flex1_1_flex1_2_k10_queue_and_full_refund_resolvers_fit_300_tgas() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target");
    let wasm =
        std::fs::read(base.join("wasm32-unknown-unknown/release/infernear_rhea_vault.wasm"))?;
    let mock = std::fs::read(
        base.join("mock/wasm32-unknown-unknown/release/infernear_rhea_test_mock.wasm"),
    )?;
    let token = fixture(&worker, &mock, "token", None).await?;
    let rhea = fixture(&worker, &mock, "rhea", Some(token.id())).await?;
    let intents = fixture(&worker, &mock, "intents", Some(token.id())).await?;
    let treasury = worker.dev_create_account().await?;
    // Patch only the local account name so committed signatures use their exact
    // fixture domain. No mainnet state is imported or modified.
    let id: AccountId = "vault.near".parse()?;
    let key = SecretKey::from_seed(KeyType::ED25519, "synthetic-vault-bootstrap");
    let mut details = AccountDetailsPatch::default();
    details.balance = Some(NearToken::from_near(100));
    worker
        .patch(&id)
        .account(details)
        .access_key(key.public_key(), AccessKey::full_access())
        .code(&wasm)
        .transact()
        .await?;
    let vault = Contract::from_secret_key(id, key, &worker);
    init_vault(
        &root, &vault, &token, &rhea, &intents, &treasury, 10_000_000,
    )
    .await?;
    let _ = invoke(
        &root,
        &token,
        "mint",
        json!({"account_id":root.id(),"amount":"40000000"}),
        0,
    )
    .await?;
    let data: Value =
        near_sdk::serde_json::from_str(include_str!("../test-vectors/withdrawals.json"))?;
    let mut users = Vec::new();
    for vector in data["worst"].as_array().unwrap() {
        let body: Value = near_sdk::serde_json::from_str(vector["message"].as_str().unwrap())?;
        let user = body["user"].as_str().unwrap().to_string();
        deposit(&root, &token, &vault, &user).await?;
        users.push(user);
    }
    let _ = invoke(&root, &vault, "run", json!({}), 0).await?;
    for (index, vector) in data["worst"].as_array().unwrap().iter().enumerate() {
        let _ = invoke(
            &root,
            &vault,
            "request_withdraw",
            json!({"message":vector["message"],"signature":vector["signature"]}),
            0,
        )
        .await?;
        deposit(&root, &token, &vault, &users[index]).await?;
    }
    let outcome = invoke(&root, &vault, "run", json!({}), 0).await?;
    println!(
        "K=10 returns + K=10 exits: gas_burnt={}, receipts={}",
        outcome.total_gas_burnt.as_gas(),
        outcome.receipt_outcomes().len()
    );
    ensure!(
        outcome.total_gas_burnt.as_gas() <= Gas::from_tgas(300).as_gas(),
        "exceeded prepaid budget"
    );
    assert_cash(&vault, &token, &users).await?;
    ensure!(
        vault.view("paid_total").await?.json::<String>()? == "0",
        "treasury paid in exit cycle"
    );
    let sent = outcome
        .logs()
        .iter()
        .filter(|log| log.contains("cash_sent") && log.contains("exit"))
        .count();
    ensure!(
        sent > 0 && sent < 10,
        "gas-bounded exit progress not exercised"
    );

    ensure!(
        outcome
            .logs()
            .iter()
            .any(|log| log.contains("cash_sent") && log.contains("return")),
        "CR1-2: returns must progress alongside exits"
    );

    // Treasury and exits are mutually exclusive; measure the separate worst-case
    // branch with ten queued returns and a real treasury payment.
    let second = worker.dev_deploy(&wasm).await?;
    init_vault(
        &root, &second, &token, &rhea, &intents, &treasury, 1_000_000,
    )
    .await?;
    deposit(&root, &token, &second, &users[0]).await?;
    let _ = invoke(&root, &second, "run", json!({}), 0).await?;
    let _ = invoke(
        &root,
        &rhea,
        "add_yield",
        json!({"account_id":second.id(),"amount":"1000"}),
        0,
    )
    .await?;
    let _ = invoke(
        &root,
        &token,
        "mint",
        json!({"account_id":rhea.id(),"amount":"1000"}),
        0,
    )
    .await?;
    for user in &users {
        deposit(&root, &token, &second, user).await?;
    }
    let outcome = invoke(&root, &second, "run", json!({}), 0).await?;
    println!(
        "K=10 returns + treasury: gas_burnt={}, receipts={}",
        outcome.total_gas_burnt.as_gas(),
        outcome.receipt_outcomes().len()
    );
    assert_cash(&second, &token, &users).await?;
    ensure!(
        second.view("paid_total").await?.json::<String>()? == "1000",
        "treasury payment missing"
    );
    // Flex1-1: the direct-send branch has the largest resolver record count.
    // Make Intents return every token so each record takes its refund path.
    let _ = invoke(&root, &intents, "return_all_deposits", json!({}), 0).await?;
    let pending_before = token
        .view("ft_balance_of")
        .args_json(json!({"account_id":second.id()}))
        .await?
        .json::<String>()?;
    let outcome = invoke(&root, &second, "run", json!({}), 0).await?;
    let returns = outcome
        .logs()
        .iter()
        .filter(|log| log.contains("cash_sent") && log.contains("return"))
        .count();
    ensure!(returns >= 3, "largest resolver branch not exercised");
    assert_cash(&second, &token, &users).await?;
    ensure!(
        token
            .view("ft_balance_of")
            .args_json(json!({"account_id":second.id()}))
            .await?
            .json::<String>()?
            == pending_before,
        "full refunds changed cash"
    );
    let resolver = outcome
        .receipt_outcomes()
        .iter()
        .find(|receipt| receipt.logs.iter().any(|log| log.contains("cash_resolved")))
        .cloned()
        .expect("joined resolver receipt");
    println!(
        "direct returns/full refunds: gas_burnt={}, records={}, resolver_burnt={}, resolver_budget={}",
        outcome.total_gas_burnt.as_gas(),
        returns,
        resolver.gas_burnt.as_gas(),
        (20 + 8 * returns as u64) * 1_000_000_000_000
    );
    Ok(())
}
