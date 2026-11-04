use super::*;
use near_sdk::{
    MockedBlockchain,
    test_utils::{VMContextBuilder, get_logs},
    testing_env,
};
use proptest::prelude::*;
use std::panic::{AssertUnwindSafe, catch_unwind};

const KEEPER: &str = "keeper.near";
const GATEWAY: &str = "gateway.near";
const ALICE: &str = "eip155:8453:0x1111111111111111111111111111111111111111";
const BOB: &str = "eip155:8453:0x2222222222222222222222222222222222222222";
const VAULT: &str = "eip155:8453:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn caller(account: &str) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id("connector.near".parse().unwrap())
        .predecessor_account_id(account.parse().unwrap())
        .storage_usage(env::storage_usage());
    testing_env!(context.build());
}

fn setup() -> Connector {
    env::set_blockchain_interface(MockedBlockchain::default());
    caller(KEEPER);
    Connector::new(KEEPER.parse().unwrap(), GATEWAY.parse().unwrap())
}

fn post(contract: &mut Connector, paid: u128, entries: &[(&str, u128)]) {
    caller(KEEPER);
    contract.post_credits(
        VAULT.into(),
        U128(paid),
        entries
            .iter()
            .map(|(u, n)| (u.to_string(), U128(*n)))
            .collect(),
    );
}

fn receipt(id: &str) -> Receipt {
    Receipt {
        inference_id: id.into(),
        chat_id: "chat-completion".into(),
        model: "fixture-model".into(),
        prompt_tokens: Some(10),
        completion_tokens: Some(20),
        in_price_nano: U128(300),
        out_price_nano: U128(900),
        source: ReceiptSource::SignedUsage,
    }
}

fn rejected(action: impl FnOnce()) {
    assert!(catch_unwind(AssertUnwindSafe(action)).is_err());
}

#[test]
fn defaults_and_json_match_interface() {
    let contract = setup();
    assert_eq!(
        near_sdk::serde_json::to_value(contract.account(ALICE.into())).unwrap(),
        near_sdk::serde_json::json!({"credited":"0", "spent":"0", "available":"0", "key_epoch":0})
    );
    assert_eq!(
        near_sdk::serde_json::to_value(contract.vault(VAULT.into())).unwrap(),
        near_sdk::serde_json::json!({"paid_cum":"0", "posted_total":"0"})
    );
    assert_eq!(contract.debited_amount("missing".into()), None);
    let json = near_sdk::serde_json::to_value(receipt("id")).unwrap();
    assert_eq!(
        json,
        near_sdk::serde_json::json!({
            "inference_id":"id", "chat_id":"chat-completion", "model":"fixture-model",
            "prompt_tokens":10, "completion_tokens":20, "in_price_nano":"300", "out_price_nano":"900", "source":"signed_usage"
        })
    );
    let mut billing = receipt("billing-id");
    billing.source = ReceiptSource::Billing;
    billing.prompt_tokens = None;
    billing.completion_tokens = None;
    let json = near_sdk::serde_json::to_value(&billing).unwrap();
    assert_eq!(json["source"], "billing");
    assert!(json["prompt_tokens"].is_null());
    assert_eq!(
        near_sdk::serde_json::from_value::<Receipt>(json).unwrap(),
        billing
    );
    assert!(
        near_sdk::serde_json::from_value::<Receipt>(
            near_sdk::serde_json::json!({"source":"unknown"})
        )
        .is_err()
    );
}

#[test]
fn posting_is_cumulative_replay_safe_and_paid_is_monotonic() {
    let mut contract = setup();
    post(&mut contract, 100, &[(ALICE, 30), (BOB, 40)]);
    contract.users.flush();
    contract.posted.flush();
    contract.vaults.flush();
    let usage = env::storage_usage();
    post(&mut contract, 1, &[(ALICE, 30), (BOB, 40)]);
    contract.users.flush();
    contract.posted.flush();
    contract.vaults.flush();
    assert_eq!(env::storage_usage(), usage);
    assert!(get_logs().is_empty());
    post(&mut contract, 80, &[(ALICE, 50)]);
    assert_eq!(contract.account(ALICE.into()).credited, U128(50));
    assert_eq!(
        contract.vault(VAULT.into()),
        Vault {
            paid_cum: U128(100),
            posted_total: U128(90)
        }
    );
    post(&mut contract, 120, &[]);
    assert_eq!(contract.vault(VAULT.into()).paid_cum, U128(120));
}

#[test]
fn invalid_post_batches_change_nothing() {
    let mut contract = setup();
    post(&mut contract, 100, &[(ALICE, 30), (BOB, 40)]);
    // The valid first entry and the new paid watermark must also roll back.
    rejected(|| post(&mut contract, 200, &[(ALICE, 50), (BOB, 39)]));
    assert_eq!(contract.account(ALICE.into()).credited, U128(30));
    assert_eq!(contract.vault(VAULT.into()).paid_cum, U128(100));
    rejected(|| post(&mut contract, 100, &[(ALICE, 61)]));
    assert_eq!(contract.vault(VAULT.into()).posted_total, U128(70));
    assert_eq!(contract.account(ALICE.into()).credited, U128(30));
    post(&mut contract, 100, &[(ALICE, 50), (ALICE, 60)]);
    assert_eq!(contract.account(ALICE.into()).credited, U128(60));
    assert_eq!(contract.vault(VAULT.into()).posted_total, U128(100));
    rejected(|| post(&mut contract, 200, &[(ALICE, 70), (ALICE, 69)]));
    assert_eq!(contract.account(ALICE.into()).credited, U128(60));
}

#[test]
fn vault_budgets_are_independent_and_user_credit_aggregates() {
    let mut contract = setup();
    post(&mut contract, 100, &[(ALICE, 100)]);
    let other = "eip155:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    contract.post_credits(other.into(), U128(50), vec![(ALICE.into(), U128(50))]);
    assert_eq!(contract.account(ALICE.into()).credited, U128(150));
    rejected(|| contract.post_credits(other.into(), U128(50), vec![(BOB.into(), U128(1))]));
    assert_eq!(contract.account(BOB.into()).credited, U128(0));
}

#[test]
fn debit_is_globally_idempotent_and_spends_only_available_credit() {
    let mut contract = setup();
    post(&mut contract, 100, &[(ALICE, 100)]);
    caller(GATEWAY);
    contract.debit(ALICE.into(), U128(60), receipt("inference-1"));
    assert_eq!(
        contract.debited_amount("inference-1".into()),
        Some(U128(60))
    );
    caller(GATEWAY);
    // Even different retry arguments cannot charge an existing inference again.
    contract.debit(BOB.into(), U128(u128::MAX), receipt("inference-1"));
    assert!(get_logs().is_empty());
    assert_eq!(contract.account(BOB.into()).spent, U128(0));
    assert_eq!(contract.account(ALICE.into()).available, U128(40));
    rejected(|| contract.debit(ALICE.into(), U128(41), receipt("inference-2")));
    assert_eq!(contract.debited_amount("inference-2".into()), None);
    assert_eq!(contract.account(ALICE.into()).spent, U128(60));
    contract.debit(ALICE.into(), U128(40), receipt("inference-2"));
    assert_eq!(contract.account(ALICE.into()).available, U128(0));
    contract.debit(BOB.into(), U128(0), receipt("zero-cost"));
    contract.debit(ALICE.into(), U128(1), receipt("zero-cost"));
    assert_eq!(contract.debited_amount("zero-cost".into()), Some(U128(0)));
}

#[test]
fn caller_checks_use_predecessor_for_every_mutation_and_retry() {
    let mut contract = setup();
    post(&mut contract, 10, &[(ALICE, 10)]);
    caller(GATEWAY);
    contract.debit(ALICE.into(), U128(1), receipt("existing"));
    for wrong in ["outsider.near", KEEPER] {
        caller(wrong);
        rejected(|| contract.debit(ALICE.into(), U128(1), receipt("new")));
        rejected(|| contract.debit(ALICE.into(), U128(1), receipt("existing")));
        rejected(|| {
            contract.bump_key_epoch(ALICE.into());
        });
    }
    for wrong in ["outsider.near", GATEWAY] {
        caller(wrong);
        rejected(|| contract.post_credits(VAULT.into(), U128(20), vec![(ALICE.into(), U128(20))]));
    }
    assert_eq!(contract.account(ALICE.into()).credited, U128(10));
    assert_eq!(contract.account(ALICE.into()).spent, U128(1));
    assert_eq!(contract.account(ALICE.into()).key_epoch, 0);
}

#[test]
fn epoch_increments_without_moving_credit() {
    let mut contract = setup();
    caller(GATEWAY);
    assert_eq!(contract.bump_key_epoch(ALICE.into()), 1);
    assert_eq!(contract.bump_key_epoch(ALICE.into()), 2);
    post(&mut contract, 10, &[(ALICE, 10)]);
    caller(GATEWAY);
    contract.debit(ALICE.into(), U128(3), receipt("id"));
    assert_eq!(contract.bump_key_epoch(ALICE.into()), 3);
    assert_eq!(
        contract.account(ALICE.into()),
        Account {
            credited: U128(10),
            spent: U128(3),
            available: U128(7),
            key_epoch: 3
        }
    );
    contract
        .users
        .get_mut(&ALICE.to_string())
        .unwrap()
        .key_epoch = u32::MAX;
    rejected(|| {
        contract.bump_key_epoch(ALICE.into());
    });
    assert_eq!(contract.account(ALICE.into()).key_epoch, u32::MAX);
}

#[test]
fn integer_boundaries_do_not_wrap_or_partially_post() {
    let mut contract = setup();
    post(&mut contract, u128::MAX, &[(ALICE, u128::MAX)]);
    rejected(|| post(&mut contract, u128::MAX, &[(BOB, 1)]));
    rejected(|| {
        contract.post_credits(
            "second-vault".into(),
            U128(1),
            vec![(ALICE.into(), U128(1))],
        )
    });
    assert_eq!(contract.vault("second-vault".into()).paid_cum, U128(0));
    caller(GATEWAY);
    contract.debit(ALICE.into(), U128(u128::MAX), receipt("max"));
    rejected(|| contract.debit(ALICE.into(), U128(1), receipt("overflow")));
    assert_eq!(contract.account(ALICE.into()).available, U128(0));
}

fn event() -> near_sdk::serde_json::Value {
    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    let value: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(logs[0].strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(value["standard"], "infernear");
    assert_eq!(value["version"], "1.0.0");
    assert_eq!(value["data"].as_array().unwrap().len(), 1);
    value
}

#[test]
fn nep297_events_include_cumulative_posts_receipts_and_epochs() {
    let mut contract = setup();
    post(&mut contract, 10, &[(ALICE, 10)]);
    let posted = event();
    assert_eq!(posted["event"], "post_credits");
    assert_eq!(
        posted["data"][0],
        near_sdk::serde_json::json!({"vault":VAULT,"paid_cum":"10","entries":[[ALICE,"10"]]})
    );
    caller(GATEWAY);
    let usage = receipt("event-id");
    let expected_receipt = near_sdk::serde_json::to_value(&usage).unwrap();
    contract.debit(ALICE.into(), U128(3), usage);
    let debit = event();
    assert_eq!(debit["event"], "debit");
    assert_eq!(
        debit["data"][0],
        near_sdk::serde_json::json!({"user":ALICE,"amount_micro":"3","receipt":expected_receipt})
    );
    caller(GATEWAY);
    contract.bump_key_epoch(ALICE.into());
    assert_eq!(event()["event"], "key_epoch");
    assert_eq!(
        event()["data"][0],
        near_sdk::serde_json::json!({"user":ALICE,"key_epoch":1})
    );
}

#[test]
fn debit_storage_measurement() {
    let mut contract = setup();
    post(&mut contract, 100, &[(ALICE, 100)]);
    contract.users.flush();
    contract.posted.flush();
    contract.vaults.flush();
    env::state_write(&contract);
    caller(GATEWAY);
    let before = env::storage_usage();
    let id = "01234567-89ab-cdef-0123-456789abcdef";
    contract.debit(ALICE.into(), U128(1), receipt(id));
    contract.users.flush();
    contract.debited.flush();
    env::state_write(&contract);
    let bytes = env::storage_usage() - before;
    let price = env::storage_byte_cost().as_yoctonear();
    println!(
        "debit: inference_id_bytes={}, added_bytes={bytes}, storage_byte_cost_yocto={price}, cost_yocto={}",
        id.len(),
        u128::from(bytes) * price
    );
    // Prefix + Borsh string length + id + u128 amount + runtime record overhead.
    assert_eq!(bytes, 1 + 4 + id.len() as u64 + 16 + 40);
    let before_retry = env::storage_usage();
    contract.debit(ALICE.into(), U128(1), receipt(id));
    contract.users.flush();
    contract.debited.flush();
    env::state_write(&contract);
    assert_eq!(env::storage_usage(), before_retry);
    // Confirm persisted values survive reconstructing the contract (a new call).
    let reloaded: Connector = env::state_read().unwrap();
    assert_eq!(reloaded.account(ALICE.into()).spent, U128(1));
    assert_eq!(reloaded.debited_amount(id.into()), Some(U128(1)));
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 96, failure_persistence: None, ..ProptestConfig::default() })]
    #[test]
    fn ledger_conservation_across_sequences(ops in prop::collection::vec((0u8..6, 0usize..3, 0usize..2, 0u128..10_000, 0u8..16), 1..80)) {
        let mut contract = setup();
        let users = [ALICE, BOB, "eip155:1:0x3333333333333333333333333333333333333333"];
        let vaults = [VAULT, "eip155:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
        let mut posted = [[0u128; 3]; 2];
        let mut paid = [0u128; 2];
        let mut spent = [0u128; 3];
        let mut epochs = [0u32; 3];
        let mut debited = BTreeMap::new();
        for (kind, u, v, amount, id) in ops {
            let credit: u128 = posted.iter().map(|p| p[u]).sum();
            match kind {
                0 => {
                    paid[v] += amount;
                    posted[v][u] += amount;
                    caller(KEEPER);
                    contract.post_credits(vaults[v].into(), U128(paid[v]), vec![(users[u].into(), U128(posted[v][u]))]);
                }
                1 => {
                    caller(KEEPER);
                    contract.post_credits(vaults[v].into(), U128(0), vec![(users[u].into(), U128(posted[v][u]))]);
                }
                2 if posted[v][u] > 0 => {
                    caller(KEEPER);
                    rejected(|| contract.post_credits(vaults[v].into(), U128(paid[v]), vec![(users[u].into(), U128(posted[v][u] - 1))]));
                }
                3 => {
                    caller(KEEPER);
                    rejected(|| contract.post_credits(vaults[v].into(), U128(paid[v]), vec![(users[u].into(), U128(posted[v][u] + paid[v] + 1))]));
                }
                4 => {
                    caller(GATEWAY);
                    let key = format!("inference-{id}");
                    if debited.contains_key(&key) {
                        contract.debit(users[u].into(), U128(amount), receipt(&key));
                    } else if amount <= credit - spent[u] {
                        contract.debit(users[u].into(), U128(amount), receipt(&key));
                        debited.insert(key, amount);
                        spent[u] += amount;
                    } else {
                        rejected(|| contract.debit(users[u].into(), U128(amount), receipt(&key)));
                    }
                }
                5 => {
                    caller(GATEWAY);
                    epochs[u] += 1;
                    prop_assert_eq!(contract.bump_key_epoch(users[u].into()), epochs[u]);
                }
                _ => {}
            }
            contract.users.flush();
            contract.vaults.flush();
            contract.posted.flush();
            contract.debited.flush();
            env::state_write(&contract);
            drop(contract);
            contract = env::state_read().unwrap();
            let mut total_credited = 0;
            let mut total_spent = 0;
            for i in 0..3 {
                let account = contract.account(users[i].into());
                let credit: u128 = posted.iter().map(|p| p[i]).sum();
                prop_assert_eq!(account.credited.0, credit);
                prop_assert_eq!(account.spent.0, spent[i]);
                prop_assert_eq!(account.available.0, credit - spent[i]);
                prop_assert_eq!(account.key_epoch, epochs[i]);
                prop_assert!(account.spent.0 <= account.credited.0);
                total_credited += account.credited.0;
                total_spent += account.spent.0;
            }
            let mut total_paid = 0;
            for i in 0..2 {
                let vault = contract.vault(vaults[i].into());
                prop_assert_eq!(vault.paid_cum.0, paid[i]);
                prop_assert_eq!(vault.posted_total.0, posted[i].iter().sum::<u128>());
                prop_assert!(vault.posted_total.0 <= vault.paid_cum.0);
                total_paid += vault.paid_cum.0;
            }
            prop_assert!(total_spent <= total_credited);
            prop_assert!(total_credited <= total_paid);
            prop_assert_eq!(debited.values().sum::<u128>(), total_spent);
            for (key, amount) in &debited {
                prop_assert_eq!(contract.debited_amount(key.clone()), Some(U128(*amount)));
            }
        }
    }
}
