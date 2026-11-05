use super::*;
use near_sdk::serde_json::{Value, json};
use near_sdk::{
    MockedBlockchain, PromiseResult,
    test_utils::{VMContextBuilder, get_created_receipts, get_logs},
    testing_env,
};
use std::{
    collections::BTreeMap,
    panic::{AssertUnwindSafe, catch_unwind},
};

fn context(caller: &str, gas: u64, results: Vec<PromiseResult>, balance: NearToken) {
    let mut c = VMContextBuilder::new();
    c.current_account_id("vault.near".parse().unwrap())
        .predecessor_account_id(caller.parse().unwrap())
        .account_balance(balance)
        .storage_usage(env::storage_usage())
        .block_timestamp(10_000_000_000)
        .prepaid_gas(Gas::from_tgas(gas));
    testing_env!(
        c.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}
fn caller(name: &str) {
    context(name, 300, vec![], NearToken::from_near(1000));
}
fn callback(gas: u64, results: Vec<PromiseResult>) {
    context("vault.near", gas, results, NearToken::from_near(1000));
}
fn ok(value: Value) -> PromiseResult {
    PromiseResult::Successful(near_sdk::serde_json::to_vec(&value).unwrap())
}
fn rejected(f: impl FnOnce()) {
    assert!(catch_unwind(AssertUnwindSafe(f)).is_err());
}
fn user(i: u64) -> String {
    format!("eip155:8453:0x{i:040x}")
}
fn vectors() -> Value {
    near_sdk::serde_json::from_str(include_str!("../test-vectors/withdrawals.json")).unwrap()
}
fn vector(name: &str) -> Value {
    vectors()["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == name)
        .unwrap()
        .clone()
}
fn vector_user() -> String {
    near_sdk::serde_json::from_str::<Withdrawal>(vector("v27")["message"].as_str().unwrap())
        .unwrap()
        .user
}
fn request(v: &mut RheaUsdcVault, name: &str) {
    let data = vector(name);
    v.request_withdraw(
        data["message"].as_str().unwrap().into(),
        data["signature"].as_str().unwrap().into(),
    );
}

struct Model {
    vault: RheaUsdcVault,
    cash: u128,
    supplied: u128,
    liquidity: u128,
    treasury: u128,
    intents: BTreeMap<String, u128>,
    withdraw_ok: bool,
    supply_used: u128,
    delivery_used: u128,
    send_failed: bool,
}
impl Model {
    fn new(cushion: u128, cap: u128) -> Self {
        env::set_blockchain_interface(MockedBlockchain::default());
        caller("keeper.near");
        let vault = RheaUsdcVault::new(
            "usdc.near".parse().unwrap(),
            "rhea.near".parse().unwrap(),
            "intents.near".parse().unwrap(),
            "treasury.near".parse().unwrap(),
            U128(cushion),
            U128(1),
            U128(cap),
        );
        env::state_write(&vault);
        Self {
            vault,
            cash: cushion,
            supplied: 0,
            liquidity: 1_000_000_000_000,
            treasury: 0,
            intents: BTreeMap::new(),
            withdraw_ok: true,
            supply_used: 10_000,
            delivery_used: 10_000,
            send_failed: false,
        }
    }
    fn accept(&mut self, user: &str, amount: u128) {
        caller("usdc.near");
        let returned = self.vault.ft_on_transfer(
            "router.near".parse().unwrap(),
            U128(amount),
            json!({"user":user}).to_string(),
        );
        self.cash += amount - returned.0;
        assert_eq!(returned, U128(0));
    }
    fn start(&mut self) {
        caller("keeper.near");
        drop(self.vault.run());
    }
    fn measure(&mut self) {
        callback(
            250,
            vec![
                ok(
                    json!({"supplied":[{"token_id":"usdc.near","balance":(self.supplied*INTERNAL_SCALE).to_string()}]}),
                ),
                ok(json!({
                    "supplied":{"balance":(self.liquidity*INTERNAL_SCALE).to_string()},"borrowed":{"balance":"0"},"reserved":"0","prot_fee":"0",
                    "margin_debt":{"balance":"0"},"margin_pending_debt":"0"
                })),
            ],
        );
        drop(self.vault.after_measure());
    }
    fn resolve(&mut self) {
        match self.vault.cycle.phase {
            2 => {
                let w = self.vault.cycle.withdraw;
                assert!(w > 0 && w <= self.supplied && w <= self.liquidity);
                if self.withdraw_ok {
                    self.supplied -= w;
                    self.cash += w;
                }
                callback(160, vec![ok(json!(self.withdraw_ok))]);
                drop(self.vault.after_withdraw());
            }
            3 => {
                let mut results = Vec::new();
                for sent in self
                    .vault
                    .cycle
                    .sent
                    .iter()
                    .take(self.vault.cycle.sent_len as usize)
                {
                    if self.send_failed {
                        results.push(PromiseResult::Failed);
                        continue;
                    }
                    if sent.kind == TREASURY {
                        self.cash -= sent.amount;
                        self.treasury += sent.amount;
                        results.push(PromiseResult::Successful(vec![]));
                    } else {
                        let node = if sent.kind == RETURN {
                            self.vault.incoming.nodes.get(&sent.node)
                        } else {
                            self.vault.outgoing.nodes.get(&sent.node)
                        }
                        .unwrap();
                        let used = sent.amount * self.delivery_used / 10_000;
                        self.cash -= used;
                        *self.intents.entry(node.user).or_default() += used;
                        results.push(ok(json!(used.to_string())));
                    }
                }
                callback(20 + 8 * u64::from(self.vault.cycle.sent_len), results);
                assert!(self.vault.after_send());
            }
            4 => {
                let sent = self.vault.cycle.supply;
                let used = if self.send_failed {
                    0
                } else {
                    sent * self.supply_used / 10_000
                };
                self.cash -= used;
                self.supplied += used;
                callback(
                    20,
                    vec![if self.send_failed {
                        PromiseResult::Failed
                    } else {
                        ok(json!(used.to_string()))
                    }],
                );
                assert!(self.vault.after_supply());
            }
            phase => panic!("unexpected model phase {phase}"),
        }
    }
    fn finish(&mut self) {
        for _ in 0..4 {
            if !self.vault.busy {
                break;
            }
            self.resolve();
        }
        assert!(!self.vault.busy);
        self.cash_invariant();
    }
    fn cycle(&mut self) {
        self.start();
        self.measure();
        self.finish();
    }
    fn cash_invariant(&self) {
        assert_eq!(
            self.vault.totals.idle + self.vault.totals.pending_in,
            self.cash
        );
    }
    fn claim(&mut self, owner: &str, amount: u128) {
        // Signature verification is covered independently by committed wallet vectors.
        let mut user = self.vault.users.get(&owner.to_string()).unwrap();
        let id = self.vault.outgoing.append(owner.to_string(), amount);
        user.pending_out = Some(PendingOut { amount, node: id });
        self.vault.users.insert(&owner.to_string(), &user);
    }
}

#[test]
fn receiver_rejects_wrong_token_bad_messages_minimum_and_storage_without_mutation() {
    let mut m = Model::new(0, 1_000_000_000);
    let valid = json!({"user":user(1)}).to_string();
    caller("wrong.near");
    assert_eq!(
        m.vault
            .ft_on_transfer("router.near".parse().unwrap(), U128(10), valid.clone()),
        U128(10)
    );
    for msg in [
        "null".into(),
        "{".into(),
        json!({"user":"eip155:1:0x1111111111111111111111111111111111111111"}).to_string(),
        json!({"user":"eip155:8453:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}).to_string(),
    ] {
        caller("usdc.near");
        assert_eq!(
            m.vault
                .ft_on_transfer("router.near".parse().unwrap(), U128(10), msg),
            U128(10)
        );
    }
    m.vault.min_deposit = 100;
    caller("usdc.near");
    assert_eq!(
        m.vault
            .ft_on_transfer("router.near".parse().unwrap(), U128(99), valid.clone()),
        U128(99)
    );
    context("usdc.near", 300, vec![], NearToken::from_yoctonear(0));
    assert_eq!(
        m.vault
            .ft_on_transfer("router.near".parse().unwrap(), U128(100), valid),
        U128(100)
    );
    assert_eq!(m.vault.holders.len(), 0);
    assert_eq!(m.vault.totals.pending_in, 0);
}

#[test]
fn acceptance_allocates_complete_record_and_storage_estimate_covers_actual_growth() {
    let mut m = Model::new(0, 1_000_000_000);
    let who = user(1);
    let before = env::storage_usage();
    m.accept(&who, 1_000_000);
    let growth = env::storage_usage() - before;
    let record = m.vault.users.get(&who).unwrap();
    assert_eq!(record.principal, 0);
    assert_eq!(record.credited_scaled, 0);
    assert_eq!(record.nonce, 0);
    assert_eq!(record.pending_in, 1_000_000);
    assert!(record.pending_out.is_none());
    assert_eq!(m.vault.holders(0, 10), vec![who.clone()]);
    assert!(get_created_receipts().is_empty());
    println!("accepted new-holder storage bytes={growth}");
    let free = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
    context("usdc.near", 300, vec![], NearToken::from_yoctonear(free));
    assert_eq!(
        m.vault.ft_on_transfer(
            "router.near".parse().unwrap(),
            U128(1_000_000),
            json!({"user":user(2)}).to_string()
        ),
        U128(1_000_000)
    );
    assert_eq!(m.vault.holders.len(), 1);
    m.cash_invariant();
}

#[test]
fn pending_cash_never_becomes_surplus_and_activation_earns_no_old_yield() {
    let mut m = Model::new(10, 1_000_000_000);
    let a = user(1);
    let b = user(2);
    m.accept(&a, 1_000_000);
    m.cycle();
    m.supplied += 100;
    m.start();
    m.accept(&b, 2_000_000);
    m.measure();
    assert_eq!(m.vault.position(a).yield_credited, U128(100));
    assert_eq!(m.vault.position(b).yield_credited, U128(0));
    assert_eq!(m.vault.unpaid(), U128(100));
    m.finish();
    assert_eq!(m.treasury, 100);
    assert_eq!(m.vault.paid_total(), U128(100));
    assert_eq!(m.vault.totals.principal, 3_000_000);
    assert!(m.supplied + m.vault.totals.idle >= m.vault.totals.principal);
}

#[test]
fn supply_unused_and_failed_results_restore_accounted_idle() {
    for failed in [false, true] {
        let mut m = Model::new(0, 2_000_000);
        m.accept(&user(1), 1_000_000);
        m.supply_used = 6000;
        m.send_failed = failed;
        m.cycle();
        assert_eq!(m.vault.idle().0, if failed { 1_000_000 } else { 400_000 });
        m.cash_invariant();
    }
}

#[test]
fn principal_exits_are_funded_before_any_treasury_payment() {
    let mut m = Model::new(10, 1_000_000_000);
    let a = user(1);
    m.accept(&a, 1_000_000);
    m.cycle();
    m.supplied += 100;
    m.claim(&a, 1_000_000);
    m.start();
    m.measure();
    assert_eq!(m.vault.cycle.withdraw, 1_000_000);
    m.finish();
    assert_eq!(m.treasury, 0);
    assert_eq!(m.intents[&a], 1_000_000);
    assert_eq!(m.vault.paid_total(), U128(0));
    m.cycle();
    assert_eq!(m.treasury, 100);
    assert_eq!(m.vault.paid_total(), U128(100));
    m.cash_invariant();
}

#[test]
fn cap_returns_and_partial_return_refunds_requeue_without_callback_storage_allocation() {
    let mut m = Model::new(0, 1_000_000);
    let a = user(1);
    let b = user(2);
    m.accept(&a, 1_000_000);
    m.cycle();
    m.accept(&b, 1_000_000);
    m.delivery_used = 5000;
    m.start();
    m.measure();
    assert_eq!(m.vault.cycle.phase, 3);
    let usage = env::storage_usage();
    m.finish();
    assert!(env::storage_usage() <= usage);
    assert_eq!(m.vault.position(b.clone()).pending_in, U128(500_000));
    assert_eq!(m.intents[&b], 500_000);
    m.delivery_used = 10_000;
    m.cycle();
    assert_eq!(m.vault.position(b).pending_in, U128(0));
}

#[test]
fn loss_rejects_pending_deposits_and_restores_partial_exits_by_claim_ratio() {
    let mut m = Model::new(0, 1_000_000_000);
    let a = user(1);
    let b = user(2);
    m.accept(&a, 10);
    m.cycle();
    m.supplied = 5;
    m.accept(&b, 10);
    m.claim(&a, 10);
    m.delivery_used = 6000;
    m.cycle();
    assert_eq!(m.vault.coverage(), U128(SCALE / 2));
    assert_eq!(m.vault.position(a.clone()).principal, U128(4));
    assert!(m.vault.position(a).pending_out.is_none());
    assert_eq!(m.vault.totals.principal, 4);
    assert_eq!(m.vault.position(b).principal, U128(0));
    m.cash_invariant();
}

#[test]
fn complete_exit_failure_restores_claim_once_and_preserves_concurrent_incoming_cash() {
    let mut m = Model::new(0, 1_000_000_000);
    let a = user(1);
    let b = user(2);
    m.accept(&a, 1_000_000);
    m.cycle();
    m.claim(&a, 1_000_000);
    m.start();
    m.measure();
    m.resolve();
    assert_eq!(m.vault.cycle.phase, 3);
    m.accept(&b, 2_000_000);
    m.send_failed = true;
    m.finish();
    assert_eq!(m.vault.position(a.clone()).principal, U128(1_000_000));
    assert!(m.vault.position(a).pending_out.is_none());
    assert_eq!(m.vault.position(b).pending_in, U128(2_000_000));
    let principal = m.vault.totals.principal;
    callback(20, vec![PromiseResult::Failed]);
    assert!(!m.vault.after_send());
    assert_eq!(m.vault.totals.principal, principal);
}

#[test]
fn zero_coverage_burns_without_transfer_or_zero_rhea_withdrawal() {
    let mut m = Model::new(0, 100);
    let a = user(1);
    m.accept(&a, 10);
    m.cycle();
    m.supplied = 0;
    m.claim(&a, 10);
    m.start();
    m.measure();
    assert!(!m.vault.busy());
    assert_eq!(m.vault.position(a).principal, U128(0));
    assert!(get_created_receipts().is_empty());
    m.cash_invariant();
}

#[test]
fn withdraw_false_leaves_cash_and_lending_position_unchanged() {
    let mut m = Model::new(0, 100);
    let a = user(1);
    m.accept(&a, 10);
    m.cycle();
    m.claim(&a, 10);
    m.withdraw_ok = false;
    m.cycle();
    assert_eq!(m.cash, 0);
    assert_eq!(m.supplied, 10);
    assert_eq!(m.vault.position(a).principal, U128(10));
    assert_eq!(m.vault.totals.principal, 10);
}

#[test]
fn treasury_after_loss_is_capped_by_real_surplus_and_cushion() {
    let mut m = Model::new(10, 1_000_000_000);
    let a = user(1);
    m.accept(&a, 1_000_000);
    m.cycle();
    m.supplied += 100;
    m.start();
    m.measure();
    assert_eq!(m.vault.unpaid(), U128(100));
    m.send_failed = true;
    m.finish();
    assert_eq!(m.treasury, 0);
    m.send_failed = false;
    // The original harvest remains unpaid, but the later loss leaves no treasury surplus.
    m.supplied = m.supplied.saturating_sub(200);
    m.cycle();
    assert_eq!(m.treasury, 0);
    assert_eq!(m.vault.paid_total(), U128(0));
    m.cash_invariant();
}

#[test]
fn view_and_withdraw_promise_failures_clear_busy() {
    let mut m = Model::new(0, 100);
    m.accept(&user(1), 10);
    for results in [
        vec![PromiseResult::Failed, ok(json!(null))],
        vec![ok(json!({"supplied":[]})), PromiseResult::Failed],
        vec![
            ok(json!({"supplied":[]})),
            ok(json!({"unexpected":"shape"})),
        ],
    ] {
        m.start();
        callback(250, results);
        drop(m.vault.after_measure());
        assert!(!m.vault.busy());
        m.cash_invariant();
    }
    m.cycle();
    m.claim(&user(1), 10);
    m.start();
    m.measure();
    callback(140, vec![PromiseResult::Failed]);
    drop(m.vault.after_withdraw());
    assert!(!m.vault.busy());
    m.cash_invariant();
}

#[test]
fn eip191_vectors_both_recovery_ids_replay_and_replacement() {
    for name in ["v27", "v28"] {
        let mut m = Model::new(0, 1_000_000_000);
        let a = vector_user();
        m.accept(&a, 1_000_000);
        m.cycle();
        caller("relay.near");
        request(&mut m.vault, name);
        assert_eq!(m.vault.nonce(a.clone()), 1);
        rejected(|| request(&mut m.vault, name));
        request(&mut m.vault, "replace");
        assert_eq!(
            m.vault.position(a.clone()).pending_out,
            U128(500_000).into()
        );
        m.cycle();
        assert_eq!(m.intents[&a], 500_000);
        assert_eq!(m.vault.position(a).principal, U128(500_000));
    }
}

#[test]
fn bad_signed_requests_are_rejected_and_busy_prevents_replacement() {
    for name in [
        "zero",
        "too_large",
        "expired",
        "wrong_vault",
        "wrong_network",
        "wrong_action",
        "wrong_signer",
        "high_s",
    ] {
        let mut m = Model::new(0, 1_000_000_000);
        let a = vector_user();
        m.accept(&a, 1_000_000);
        m.cycle();
        caller("relay.near");
        rejected(|| request(&mut m.vault, name));
        assert_eq!(m.vault.nonce(a), 0);
    }
    let mut m = Model::new(0, 1_000_000_000);
    m.accept(&vector_user(), 1_000_000);
    m.cycle();
    caller("relay.near");
    request(&mut m.vault, "v27");
    m.start();
    rejected(|| request(&mut m.vault, "replace"));
    m.measure();
    m.finish();
}

#[test]
fn one_usdc_rhea_request_uses_eighteen_internal_decimals() {
    let mut m = Model::new(0, 1_000_000_000);
    let a = user(1);
    m.accept(&a, 1_000_000);
    m.cycle();
    m.claim(&a, 1_000_000);
    m.start();
    m.measure();
    let args = get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .find_map(|action| {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name, args, ..
            } = action
                && method_name == b"simple_withdraw"
            {
                return Some(near_sdk::serde_json::from_slice::<Value>(&args).unwrap());
            }
            None
        })
        .expect("scheduled Rhea withdrawal");
    assert_eq!(args["amount_with_inner_decimal"], "1000000000000000000");
    assert_eq!(
        m.vault.cycle.withdraw.checked_mul(INTERNAL_SCALE),
        Some(1_000_000_000_000_000_000)
    );
    m.finish();
}

fn scaled_invariant(m: &Model) {
    let mut credited = 0u128;
    for id in m.vault.holders(0, u64::MAX) {
        let mut user = m.vault.users.get(&id).unwrap();
        user.settle(m.vault.totals.acc).unwrap();
        credited = credited.checked_add(user.credited_scaled).unwrap();
    }
    assert_eq!(
        credited + m.vault.totals.unattributed_scaled,
        (m.vault.totals.paid + m.vault.totals.unpaid) * SCALE
    );
}

#[test]
fn fractional_entitlements_and_index_dust_conserve_at_scale_without_double_counting() {
    let mut m = Model::new(0, 100);
    let a = user(1);
    m.accept(&a, 3);
    m.cycle();
    for _ in 0..2 {
        m.supplied += 1;
        m.start();
        m.measure();
        let event = get_logs()
            .into_iter()
            .find_map(|log| {
                let json: Value =
                    near_sdk::serde_json::from_str(log.strip_prefix("EVENT_JSON:")?).ok()?;
                (json["event"] == "yield_attributed").then_some(json)
            })
            .expect("attribution event");
        assert_eq!(event["standard"], "infernear");
        assert_eq!(event["version"], "1.0.0");
        assert_eq!(event["data"][0]["amount"], "1");
        assert_eq!(event["data"][0]["attributed_scaled"], "999999999999999999");
        assert_eq!(event["data"][0]["unattributed_scaled"], "1");
        m.finish();
        scaled_invariant(&m);
    }
    assert_eq!(m.vault.position(a.clone()).yield_credited, U128(1));
    assert_eq!(m.vault.unattributed(), U128(0));
    assert_eq!(m.vault.totals.unattributed_scaled, 2);
    assert_eq!(m.treasury, 2);
    // Settlement must retain the same fractional entitlement as an untouched view.
    m.claim(&a, 1);
    m.cycle();
    scaled_invariant(&m);
}

#[test]
fn zero_supply_gain_is_unattributed_and_callback_arithmetic_overflow_clears_busy() {
    let mut m = Model::new(0, 100);
    m.supplied = 7;
    m.cycle();
    assert_eq!(m.vault.unattributed(), U128(7));
    assert_eq!(m.vault.paid_total(), U128(7));
    scaled_invariant(&m);
    let mut m = Model::new(0, 100);
    m.accept(&user(1), 1);
    m.cycle();
    m.start();
    callback(
        240,
        vec![
            ok(json!({"supplied":[{"token_id":"usdc.near","balance":u128::MAX.to_string()}]})),
            ok(json!({
                "supplied":{"balance":"0"},"borrowed":{"balance":"0"},"reserved":"0","prot_fee":"0","margin_debt":{"balance":"0"},"margin_pending_debt":"0"
            })),
        ],
    );
    drop(m.vault.after_measure());
    assert!(!m.vault.busy());
    assert_eq!(m.vault.totals.principal, 1);
    m.cash_invariant();
}

#[test]
fn cr1_2_ten_returns_and_exits_reserve_capacity_for_both_queues() {
    let mut m = Model::new(0, 10_000_000);
    for i in 1..=10 {
        m.accept(&user(i), 1_000_000);
    }
    m.cycle();
    for i in 1..=10 {
        m.claim(&user(i), 1_000_000);
        m.accept(&user(i + 10), 1_000_000);
    }
    m.start();
    m.measure();
    assert_eq!(m.vault.cycle.exits, 10);
    assert_eq!(m.vault.cycle.returns, 10);
    m.resolve();
    assert!(m.vault.cycle.sent_len > 0 && m.vault.cycle.sent_len <= 2);
    assert!(
        m.vault
            .cycle
            .sent
            .iter()
            .take(m.vault.cycle.sent_len as usize)
            .any(|sent| sent.kind == RETURN)
    );
    m.finish();
    assert_eq!(m.treasury, 0);
    scaled_invariant(&m);
    assert_eq!(m.vault.totals.pending_in, 9_000_000);
    assert!(m.vault.outgoing.first(10).len() >= 8);
}

#[test]
fn return_and_treasury_failures_clear_busy_and_reuse_reserved_queue_nodes() {
    let mut m = Model::new(0, 100);
    m.accept(&user(1), 100);
    m.cycle();
    m.accept(&user(2), 100);
    m.supplied += 10;
    m.send_failed = true;
    m.cycle();
    assert_eq!(m.vault.position(user(2)).pending_in, U128(100));
    assert_eq!(m.vault.totals.idle, 10);
    assert_eq!(m.vault.paid_total(), U128(0));
    m.send_failed = false;
    m.cycle();
    assert_eq!(m.vault.paid_total(), U128(10));
    m.cash_invariant();
    scaled_invariant(&m);
}

#[test]
fn unsolicited_cash_is_not_read_or_counted() {
    let mut m = Model::new(10, 100);
    m.cash += 99;
    m.start();
    m.measure();
    assert_eq!(m.vault.cycle.phase, 4);
    assert_eq!(m.vault.cycle.supply, 10);
    m.resolve();
    assert_eq!(m.cash - m.vault.totals.idle - m.vault.totals.pending_in, 99);
}

proptest::proptest! {
    #![proptest_config(proptest::test_runner::Config { cases:24, failure_persistence:None, ..proptest::test_runner::Config::default() })]
    #[test]
    fn cash_and_scaled_yield_conservation_across_cycles(gains in proptest::collection::vec(0u128..1000,1..16)) {
        let mut m=Model::new(7,1_000_000_000);
        for i in 1..=3 {m.accept(&user(i),1_000_000);}
        m.cycle();let mut cumulative_gain=0u128;
        for gain in gains {
            m.supplied+=gain;cumulative_gain+=gain;m.cycle();
            m.cash_invariant();scaled_invariant(&m);
            proptest::prop_assert_eq!(m.treasury,cumulative_gain);
            proptest::prop_assert!(m.supplied+m.vault.totals.idle>=m.vault.totals.principal);
            let credits:u128=(1..=3).map(|i|m.vault.position(user(i)).yield_credited.0).sum();
            proptest::prop_assert!(credits<=m.vault.totals.paid);
        }
    }
}

// CR1-1 / Flex1-R3-2: a dropped owner can authorize a smaller funded request.
#[test]
fn cr1_r3_dropped_owner_signs_a_smaller_request_that_pays_next_cycle() {
    let mut m = Model::new(0, 1_000_000);
    let owner = vector_user();
    m.accept(&owner, 1_000_000);
    m.cycle();
    caller("relay.near");
    request(&mut m.vault, "v27");
    assert_eq!(m.vault.nonce(owner.clone()), 1);
    m.liquidity = 500_000;
    m.cycle();
    assert_eq!(m.vault.idle(), U128(500_000));
    assert_eq!(m.supplied, 500_000);
    assert_eq!(m.vault.position(owner.clone()).pending_out, None);
    assert_eq!(m.vault.position(owner.clone()).principal, U128(1_000_000));
    assert_eq!(m.vault.nonce(owner.clone()), 1);
    assert!(m.vault.outgoing.first(10).is_empty());
    assert!(m.intents.is_empty());
    caller("relay.near");
    rejected(|| request(&mut m.vault, "v27")); // Dropping does not revive its nonce.
    request(&mut m.vault, "replace");
    m.liquidity = 0;
    m.cycle();
    assert_eq!(m.intents[&owner], 500_000);
    assert_eq!(m.supplied, 500_000);
    assert_eq!(m.vault.position(owner).principal, U128(500_000));
    m.cash_invariant();
    scaled_invariant(&m);
}

// CR1-2: continuous tiny exits cannot monopolize the two post-withdraw slots.
#[test]
fn cr1_2_repeated_cycles_progress_both_queues_in_fifo_order() {
    let mut m = Model::new(0, 1000);
    let owner = user(1);
    m.accept(&owner, 1000);
    m.cycle();
    for i in 2..=13 {
        m.accept(&user(i), 100);
    }
    let mut expected = m.vault.incoming.first(20);
    for tick in 0..13 {
        m.claim(&owner, 1);
        m.start();
        m.measure();
        if tick == 0 {
            // New arrivals during the withdrawal cannot pass existing returns.
            m.accept(&user(14), 100);
            expected = m.vault.incoming.first(20);
        }
        m.resolve();
        let sent = &m.vault.cycle.sent[..m.vault.cycle.sent_len as usize];
        assert!(sent.iter().any(|s| s.kind == EXIT));
        let returned = sent
            .iter()
            .find(|s| s.kind == RETURN)
            .expect("return progresses each cycle");
        assert_eq!(returned.node, expected.remove(0));
        m.finish();
        assert_eq!(m.vault.incoming.first(20), expected);
        assert_eq!(m.vault.totals.pending_in, expected.len() as u128 * 100);
        scaled_invariant(&m);
    }
    assert!(expected.is_empty());
    assert_eq!(m.intents[&owner], 13);
    for i in 2..=14 {
        assert_eq!(m.intents[&user(i)], 100);
    }
    assert_eq!(m.treasury, 0);
}

// CR1-R3-1: an unfundable K-entry prefix is removed, not scanned forever.
#[test]
fn cr1_r3_ten_unfunded_claims_do_not_exclude_the_fundable_eleventh() {
    let mut m = Model::new(0, 1_000_000_000);
    for i in 1..=10 {
        m.accept(&user(i), 99_000_000);
    }
    m.cycle();
    m.accept(&user(11), 10_000_000);
    m.cycle();
    for i in 1..=10 {
        m.claim(&user(i), 99_000_000);
    }
    m.claim(&user(11), 10_000_000);
    // Move 50 USDC into accounted cash without changing assets or coverage.
    m.supplied -= 50_000_000;
    m.cash += 50_000_000;
    m.vault.totals.idle += 50_000_000;
    m.liquidity = 0;
    m.start();
    m.measure();
    assert!(!m.vault.busy());
    let events: Vec<Value> = get_logs()
        .into_iter()
        .filter_map(|log| {
            let event: Value =
                near_sdk::serde_json::from_str(log.strip_prefix("EVENT_JSON:")?).ok()?;
            (event["event"] == "exit_unfunded").then_some(event)
        })
        .collect();
    assert_eq!(events.len(), 10);
    for (index, event) in events.into_iter().enumerate() {
        assert_eq!(event["standard"], "infernear");
        assert_eq!(event["version"], "1.0.0");
        assert_eq!(
            event["data"],
            json!([{"user":user(index as u64+1),"claim":"99000000","out":"99000000"}])
        );
        assert_eq!(
            m.vault.position(user(index as u64 + 1)).principal,
            U128(99_000_000)
        );
        assert_eq!(m.vault.position(user(index as u64 + 1)).pending_out, None);
    }
    assert_eq!(m.vault.outgoing.first(10).len(), 1);
    assert_eq!(
        m.vault.position(user(11)).pending_out,
        Some(U128(10_000_000))
    );
    assert_eq!(m.vault.idle(), U128(50_000_000));
    m.cash_invariant();
    scaled_invariant(&m);
    m.cycle();
    assert_eq!(m.intents[&user(11)], 10_000_000);
    assert!(m.vault.outgoing.first(10).is_empty());
    assert_eq!(m.vault.totals.principal, 990_000_000);
    assert_eq!(m.vault.idle(), U128(40_000_000));
    assert_eq!(m.treasury, 0);
    m.cash_invariant();
    scaled_invariant(&m);
}

#[test]
fn cr1_r3_capacity_deferred_exits_keep_fifo_and_each_gets_paid() {
    let mut m = Model::new(0, 1000);
    for i in 1..=10 {
        m.accept(&user(i), 100);
    }
    m.cycle();
    for i in 1..=10 {
        m.claim(&user(i), 100);
    }
    let mut expected = m.vault.outgoing.first(10);
    m.start();
    m.measure();
    m.resolve();
    assert_eq!(m.vault.cycle.sent_len, 2);
    for sent in &m.vault.cycle.sent[..2] {
        assert_eq!(sent.kind, EXIT);
        assert_eq!(sent.node, expected.remove(0));
    }
    assert_eq!(m.vault.outgoing.first(10), expected);
    for i in 3..=10 {
        assert_eq!(m.vault.position(user(i)).pending_out, Some(U128(100)));
    }
    m.finish();
    m.liquidity = 0; // All remaining claims are funded from the first withdrawal.
    while !expected.is_empty() {
        m.start();
        m.measure();
        for sent in &m.vault.cycle.sent[..m.vault.cycle.sent_len as usize] {
            assert_eq!(sent.kind, EXIT);
            assert_eq!(sent.node, expected.remove(0));
        }
        assert_eq!(m.vault.outgoing.first(10), expected);
        m.finish();
    }
    for i in 1..=10 {
        assert_eq!(m.intents[&user(i)], 100);
    }
    assert_eq!(m.vault.totals.principal, 0);
    m.cash_invariant();
    scaled_invariant(&m);
}

#[test]
fn flex1_1_resolver_budget_scales_with_full_refund_record_count() {
    let mut m = Model::new(0, 100);
    m.accept(&user(1), 100);
    m.cycle();
    for i in 2..=11 {
        m.accept(&user(i), 100);
    }
    let order = m.vault.incoming.first(10);
    m.start();
    m.measure();
    let count = m.vault.cycle.sent_len;
    assert!(count >= 3, "exercise maximum direct-send records");
    let gas = get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .find_map(|action| {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name,
                prepaid_gas,
                ..
            } = action
                && method_name == b"after_send"
            {
                Some(prepaid_gas)
            } else {
                None
            }
        })
        .expect("joined resolver");
    assert_eq!(gas, Gas::from_tgas(20 + 8 * u64::from(count)));
    m.send_failed = true;
    m.finish();
    assert_eq!(m.vault.incoming.first(10), order);
    assert_eq!(m.vault.totals.pending_in, 1000);
    m.cash_invariant();
}

#[test]
fn flex1_3_returned_deposits_keep_preallocated_holder_records() {
    let mut m = Model::new(0, 0);
    m.accept(&user(1), 100);
    m.cycle();
    assert_eq!(m.intents[&user(1)], 100);
    assert_eq!(m.vault.holders(0, 10), vec![user(1)]);
    assert_eq!(m.vault.position(user(1)).principal, U128(0));
    assert_eq!(m.vault.position(user(1)).pending_in, U128(0));
}

#[test]
fn flex1_5_malformed_withdrawal_has_stable_panic_without_input_fragments() {
    let mut m = Model::new(0, 100);
    for message in [
        "PRIVATE_REQUEST_FRAGMENT",
        "{\"action\":\"PRIVATE_REQUEST_FRAGMENT\"}",
    ] {
        caller("relay.near");
        let error = catch_unwind(AssertUnwindSafe(|| {
            m.vault.request_withdraw(message.into(), String::new())
        }))
        .expect_err("invalid message");
        let text = error
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| error.downcast_ref::<&str>().copied())
            .unwrap();
        assert!(text.contains("invalid withdrawal message"));
        assert!(!text.contains("PRIVATE_REQUEST_FRAGMENT"));
        assert!(m.vault.holders(0, 10).is_empty());
    }
}

#[test]
fn flex2_2_true_malleability_flag_rejects_high_s_false_accepts_it() {
    let _m = Model::new(0, 100);
    let data = vector("high_s");
    let message = data["message"].as_str().unwrap();
    let bytes: Vec<u8> = data["signature"].as_str().unwrap().as_bytes()[2..]
        .chunks_exact(2)
        .map(|b| u8::from_str_radix(std::str::from_utf8(b).unwrap(), 16).unwrap())
        .collect();
    let hash = env::keccak256(
        format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message).as_bytes(),
    );
    assert!(env::ecrecover(&hash, &bytes[..64], bytes[64] - 27, false).is_some());
    assert!(env::ecrecover(&hash, &bytes[..64], bytes[64] - 27, true).is_none());
    assert!(auth::recover(message, data["signature"].as_str().unwrap()).is_none());
    for name in ["v27", "v28"] {
        let data = vector(name);
        assert_eq!(
            auth::recover(
                data["message"].as_str().unwrap(),
                data["signature"].as_str().unwrap()
            )
            .unwrap(),
            owner_address(&vector_user())
        );
    }
}

#[test]
fn flex2_3_position_saturates_without_trapping_or_mutating_checked_state() {
    let mut m = Model::new(0, 100);
    let owner = user(1);
    m.accept(&owner, 1);
    let mut record = m.vault.users.get(&owner).unwrap();
    record.principal = u128::MAX;
    record.credited_scaled = 1;
    m.vault.users.insert(&owner, &record);
    m.vault.totals.acc = 2;
    assert_eq!(
        m.vault.position(owner.clone()).yield_credited,
        U128(u128::MAX / SCALE)
    );
    assert!(record.settle(2).is_none(), "writes still reject overflow");
    assert_eq!(m.vault.users.get(&owner).unwrap().snap, 0);
    assert_eq!(m.vault.users.get(&owner).unwrap().credited_scaled, 1);
}

#[test]
fn cr1_r3_ten_unfunded_exits_and_returns_fit_the_callback_budget() {
    let mut m = Model::new(0, 1000);
    for i in 1..=10 {
        m.accept(&user(i), 100);
    }
    m.cycle();
    for i in 1..=10 {
        m.claim(&user(i), 100);
        m.accept(&user(i + 10), 100);
    }
    m.liquidity = 50;
    m.start();
    m.measure();
    m.resolve();
    assert!(m.vault.outgoing.first(10).is_empty());
    assert!(
        m.vault.cycle.sent[..m.vault.cycle.sent_len as usize]
            .iter()
            .all(|sent| sent.kind == RETURN)
    );
    assert!(m.vault.cycle.sent_len > 0);
    m.finish();
    for i in 1..=10 {
        assert_eq!(m.vault.position(user(i)).principal, U128(100));
        assert_eq!(m.vault.position(user(i)).pending_out, None);
    }
    assert_eq!(m.vault.totals.principal, 1000);
    assert_eq!(m.vault.idle(), U128(50));
    m.cash_invariant();
    scaled_invariant(&m);
}
