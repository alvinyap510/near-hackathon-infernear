use crate::*;
use near_sdk::serde::de::DeserializeOwned;
use std::collections::BTreeMap;

const TRANSFER_GAS: u64 = 40;
const RESOLVE_GAS: u64 = 20;
const RESOLVE_RECORD_GAS: u64 = 8;
const LOCAL_GAS: u64 = 20;
const SEND_OVERHEAD_GAS: u64 = 8; // Receipt creation and joining, per send.
const SUPPLY_GAS: u64 = 60;
// after_send must fund the supply transfer-call, its resolver and receipt creation.
const SUPPLY_RESERVE_GAS: u64 = SUPPLY_GAS + RESOLVE_GAS + 2 * SEND_OVERHEAD_GAS;

struct Plan {
    totals: Totals,
    cycle: Cycle,
    users: BTreeMap<String, User>,
    activated: Vec<u64>,
    surplus: u128,
    attributed: u128,
    dust: u128,
}

fn result<T: DeserializeOwned>(index: u64) -> Option<T> {
    if index >= env::promise_results_count() {
        return None;
    }
    env::promise_result_checked(index, 65_536)
        .ok()
        .and_then(|bytes| near_sdk::serde_json::from_slice(&bytes).ok())
}
fn success(index: u64) -> bool {
    index < env::promise_results_count() && env::promise_result_checked(index, 65_536).is_ok()
}

impl RheaUsdcVault {
    fn finish(&mut self) -> bool {
        self.cycle = Cycle::default();
        self.busy = false;
        true
    }
    fn failed(&mut self, step: &str, reason: &str) -> PromiseOrValue<bool> {
        emit(
            "cycle_failed",
            near_sdk::serde_json::json!({"step":step,"reason":reason}),
        );
        self.finish();
        PromiseOrValue::Value(false)
    }
    pub(crate) fn measure_and_plan(&mut self) -> PromiseOrValue<bool> {
        if !self.busy || self.cycle.phase != 1 {
            return PromiseOrValue::Value(false);
        }
        let Some(account) = result::<Option<RheaAccount>>(0) else {
            return self.failed("measure", "account_view_failed");
        };
        let Some(Some(asset)) = result::<Option<RheaAsset>>(1) else {
            return self.failed("measure", "asset_view_failed");
        };
        let b = account
            .and_then(|a| a.supplied.into_iter().find(|a| a.token_id == self.usdc))
            .map_or(0, |a| a.balance.0 / INTERNAL_SCALE);
        let Some(liquidity) = asset.liquidity() else {
            return self.failed("measure", "asset_arithmetic_overflow");
        };
        let Some(plan) = self.plan(b, liquidity) else {
            return self.failed("plan", "arithmetic_overflow");
        };
        self.totals = plan.totals;
        self.cycle = plan.cycle;
        for (id, user) in plan.users {
            self.users.insert(&id, &user);
        }
        for id in plan.activated {
            let node = self.incoming.nodes.get(&id).expect("accepted deposit node");
            self.incoming.detach(id);
            self.incoming.nodes.remove(&id);
            emit(
                "deposit_activated",
                near_sdk::serde_json::json!({"user":node.user,"amount":U128(node.amount)}),
            );
        }
        emit(
            "cycle_measured",
            near_sdk::serde_json::json!({"supplied":U128(b),"liquidity":U128(liquidity),"idle":U128(self.totals.idle),"coverage":U128(self.totals.coverage)}),
        );
        if plan.surplus > 0 {
            emit(
                "yield_attributed",
                near_sdk::serde_json::json!({"amount":U128(plan.surplus),"attributed":U128(plan.attributed),"unattributed":U128(plan.dust / SCALE),"attributed_scaled":U128(plan.surplus * SCALE - plan.dust),"unattributed_scaled":U128(plan.dust),"acc":U128(self.totals.acc)}),
            );
        }
        if self.cycle.withdraw > 0 {
            self.cycle.phase = 2;
            let callback_gas = if self.can_supply() { 168 } else { 160 };
            PromiseOrValue::Promise(call(&self.rhea,"simple_withdraw",near_sdk::serde_json::json!({
                "token_id":self.usdc,"amount_with_inner_decimal":U128(self.cycle.withdraw.checked_mul(INTERNAL_SCALE).expect("validated Rhea units")),
                "recipient_id":env::current_account_id()
            }),1,60).then(self_callback("after_withdraw",callback_gas)))
        } else {
            self.send_or_supply()
        }
    }

    fn plan(&self, b: u128, liquidity: u128) -> Option<Plan> {
        let mut totals = self.totals.clone();
        let a = b.checked_add(totals.idle)?;
        totals.coverage = if totals.principal == 0 {
            SCALE
        } else {
            a.checked_mul(SCALE)?
                .checked_div(totals.principal)?
                .min(SCALE)
        };
        let baseline = totals
            .principal
            .checked_add(self.cushion)?
            .checked_add(totals.unpaid)?;
        let surplus = a.saturating_sub(baseline);
        let index = if totals.principal == 0 {
            0
        } else {
            surplus.checked_mul(SCALE)?.checked_div(totals.principal)?
        };
        let attributed = index.checked_mul(totals.principal)? / SCALE;
        let dust = surplus
            .checked_mul(SCALE)?
            .checked_sub(index.checked_mul(totals.principal)?)?;
        totals.acc = totals.acc.checked_add(index)?;
        totals.unattributed_scaled = totals.unattributed_scaled.checked_add(dust)?;
        totals.unpaid = totals.unpaid.checked_add(surplus)?;
        let mut cycle = Cycle::default();
        let mut users = BTreeMap::new();
        let mut activated = Vec::new();
        for id in self.incoming.first(K) {
            let node = self.incoming.nodes.get(&id)?;
            let user = users
                .entry(node.user.clone())
                .or_insert(self.users.get(&node.user)?);
            if totals.coverage == SCALE && totals.principal.checked_add(node.amount)? <= self.cap {
                user.settle(totals.acc)?;
                user.principal = user.principal.checked_add(node.amount)?;
                user.pending_in = user.pending_in.checked_sub(node.amount)?;
                totals.principal = totals.principal.checked_add(node.amount)?;
                totals.idle = totals.idle.checked_add(node.amount)?;
                totals.pending_in = totals.pending_in.checked_sub(node.amount)?;
                activated.push(id);
            } else {
                cycle.return_ids[cycle.returns as usize] = id;
                cycle.returns += 1;
            }
        }
        let mut need = 0u128;
        for id in self.outgoing.first(K) {
            let node = self.outgoing.nodes.get(&id)?;
            let user = users
                .entry(node.user.clone())
                .or_insert(self.users.get(&node.user)?);
            user.settle(totals.acc)?;
            let out = node.amount.checked_mul(totals.coverage)? / SCALE;
            cycle.exit_ids[cycle.exits as usize] = id;
            cycle.exit_outs[cycle.exits as usize] = out;
            cycle.exits += 1;
            need = need.checked_add(out)?;
        }
        if cycle.exits == 0 {
            cycle.pay = totals.unpaid.min(
                b.checked_add(totals.idle)?
                    .saturating_sub(totals.principal.checked_add(self.cushion)?),
            );
            need = cycle.pay;
        }
        cycle.withdraw = need.saturating_sub(totals.idle).min(liquidity).min(b);
        cycle.withdraw.checked_mul(INTERNAL_SCALE)?;
        Some(Plan {
            totals,
            cycle,
            users,
            activated,
            surplus,
            attributed,
            dust,
        })
    }

    pub(crate) fn withdraw_and_send(&mut self) -> PromiseOrValue<bool> {
        if !self.busy || self.cycle.phase != 2 {
            return PromiseOrValue::Value(false);
        }
        if result::<bool>(0) == Some(true) {
            self.totals.idle = self
                .totals
                .idle
                .checked_add(self.cycle.withdraw)
                .expect("accounted withdrawal overflow");
        } else {
            emit(
                "cycle_failed",
                near_sdk::serde_json::json!({"step":"withdraw","reason":"cash_not_received"}),
            );
        }
        self.send_or_supply()
    }

    fn can_supply(&self) -> bool {
        self.cycle.exits == 0 && self.cycle.returns == 0
    }

    fn send_or_supply(&mut self) -> PromiseOrValue<bool> {
        // K bounds work scanned; the prepaid-gas budget bounds actual cross-contract
        // sends. Capacity-deferred requests remain queued. Reserving the joined
        // resolver prevents low-gas batches from stranding the keyless vault busy.
        let free_gas = env::prepaid_gas()
            .as_gas()
            .saturating_sub(env::used_gas().as_gas());
        // Without principal queues the resolver handles only one fixed treasury
        // record; it needs no per-user refund/storage budget. Reserve the supply
        // tail even if treasury fails and its cash is restored.
        let (resolve_gas, record_gas, local_gas, send_overhead, supply_reserve) =
            if self.can_supply() {
                // A single fixed treasury record: 12 Tgas covers its remaining local
                // work and receipt creation; no principal-queue scan/refund budget.
                (10, 0, 0, 12, SUPPLY_RESERVE_GAS)
            } else {
                (
                    RESOLVE_GAS,
                    RESOLVE_RECORD_GAS,
                    LOCAL_GAS,
                    SEND_OVERHEAD_GAS,
                    0,
                )
            };
        let mut slots = (free_gas
            .saturating_sub(Gas::from_tgas(resolve_gas + local_gas + supply_reserve).as_gas())
            / Gas::from_tgas(TRANSFER_GAS + record_gas + send_overhead).as_gas())
            as usize;
        // Both principal queues must progress even under continuous exit traffic.
        let return_slot = usize::from(self.cycle.returns > 0);
        let mut promises = Vec::new();
        for i in 0..self.cycle.exits as usize {
            let id = self.cycle.exit_ids[i];
            let out = self.cycle.exit_outs[i];
            let node = self.outgoing.nodes.get(&id).expect("planned exit node");
            let mut user = self.users.get(&node.user).expect("allocated user");
            if out > self.totals.idle {
                // One funding attempt per request: an unfundable prefix must not
                // occupy every bounded scan forever. Principal and nonce stay put.
                user.pending_out = None;
                self.users.insert(&node.user, &user);
                self.outgoing.detach(id);
                self.outgoing.nodes.remove(&id);
                emit(
                    "exit_unfunded",
                    near_sdk::serde_json::json!({
                        "user":node.user,"claim":U128(node.amount),"out":U128(out)
                    }),
                );
                continue;
            }
            if out > 0 && slots <= return_slot {
                continue; // Capacity alone defers this node in its original order.
            }
            user.principal = user
                .principal
                .checked_sub(node.amount)
                .expect("validated principal claim");
            self.totals.principal = self
                .totals
                .principal
                .checked_sub(node.amount)
                .expect("validated total claim");
            user.pending_out = None;
            self.users.insert(&node.user, &user);
            self.outgoing.detach(id);
            if out == 0 {
                self.outgoing.nodes.remove(&id);
                emit(
                    "cash_resolved",
                    near_sdk::serde_json::json!({"kind":"exit","user":node.user,"sent":U128(0),"used":U128(0),"restored_principal":U128(0)}),
                );
            } else {
                self.totals.idle = self.totals.idle.checked_sub(out).expect("funded exit");
                self.record(Sent {
                    kind: EXIT,
                    node: id,
                    amount: out,
                    claim: node.amount,
                });
                promises.push(self.intents_transfer(&node.user, out));
                slots -= 1;
                emit(
                    "cash_sent",
                    near_sdk::serde_json::json!({"kind":"exit","user":node.user,"amount":U128(out),"claim":U128(node.amount)}),
                );
            }
        }
        // An exit-free cycle may reserve one send for its treasury payment.
        let treasury_slot =
            usize::from(self.cycle.exits == 0 && self.cycle.pay > 0 && self.totals.idle > 0);
        for i in 0..self.cycle.returns as usize {
            let id = self.cycle.return_ids[i];
            let node = self.incoming.nodes.get(&id).expect("reserved return node");
            if slots <= treasury_slot {
                break;
            }
            self.totals.pending_in = self
                .totals
                .pending_in
                .checked_sub(node.amount)
                .expect("pending return accounted");
            let mut user = self.users.get(&node.user).expect("allocated user");
            user.pending_in = user
                .pending_in
                .checked_sub(node.amount)
                .expect("user pending return");
            self.users.insert(&node.user, &user);
            self.record(Sent {
                kind: RETURN,
                node: id,
                amount: node.amount,
                claim: 0,
            });
            promises.push(self.intents_transfer(&node.user, node.amount));
            slots -= 1;
            emit(
                "cash_sent",
                near_sdk::serde_json::json!({"kind":"return","user":node.user,"amount":U128(node.amount),"claim":U128(0)}),
            );
        }
        if self.cycle.exits == 0 && self.cycle.pay > 0 && self.totals.idle > 0 && slots > 0 {
            let paid = self.cycle.pay.min(self.totals.idle);
            self.totals.idle = self
                .totals
                .idle
                .checked_sub(paid)
                .expect("funded treasury transfer");
            self.record(Sent {
                kind: TREASURY,
                node: queue::NONE,
                amount: paid,
                claim: 0,
            });
            promises.push(call(
                &self.usdc,
                "ft_transfer",
                near_sdk::serde_json::json!({"receiver_id":self.treasury,"amount":U128(paid)}),
                1,
                TRANSFER_GAS,
            ));
            emit(
                "cash_sent",
                near_sdk::serde_json::json!({"kind":"treasury","user":null,"amount":U128(paid),"claim":U128(0)}),
            );
        }
        if promises.is_empty() {
            // Exit/return plans retain unused cash, even if every send was dropped.
            return if self.can_supply() {
                self.supply()
            } else {
                PromiseOrValue::Value(self.finish())
            };
        }
        self.cycle.phase = 3;
        let joined = promises
            .into_iter()
            .reduce(Promise::and)
            .expect("nonempty sends");
        let resolver_gas =
            resolve_gas + record_gas * u64::from(self.cycle.sent_len) + supply_reserve;
        PromiseOrValue::Promise(joined.then(self_callback("after_send", resolver_gas)))
    }
    fn record(&mut self, sent: Sent) {
        self.cycle.sent[self.cycle.sent_len as usize] = sent;
        self.cycle.sent_len += 1;
    }
    fn intents_transfer(&self, user: &str, amount: u128) -> Promise {
        call(
            &self.usdc,
            "ft_transfer_call",
            near_sdk::serde_json::json!({"receiver_id":self.intents,"amount":U128(amount),"msg":owner_address(user)}),
            1,
            TRANSFER_GAS,
        )
    }
    pub(crate) fn resolve_sends(&mut self) -> PromiseOrValue<bool> {
        if !self.busy || self.cycle.phase != 3 {
            return PromiseOrValue::Value(false);
        }
        for i in 0..self.cycle.sent_len as usize {
            let sent = self.cycle.sent[i];
            let used = if sent.kind == TREASURY {
                if success(i as u64) { sent.amount } else { 0 }
            } else {
                result::<U128>(i as u64).map_or(0, |used| used.0.min(sent.amount))
            };
            let refund = sent.amount - used;
            let mut restored = 0;
            let mut user_id = None;
            let kind = match sent.kind {
                RETURN => {
                    let node = self
                        .incoming
                        .nodes
                        .get(&sent.node)
                        .expect("reserved return storage");
                    user_id = Some(node.user.clone());
                    if refund > 0 {
                        self.totals.pending_in = self
                            .totals
                            .pending_in
                            .checked_add(refund)
                            .expect("return refund overflow");
                        let mut user = self.users.get(&node.user).expect("allocated user");
                        user.pending_in = user
                            .pending_in
                            .checked_add(refund)
                            .expect("user return refund overflow");
                        self.users.insert(&node.user, &user);
                        let mut node = node;
                        node.amount = refund;
                        self.incoming.nodes.insert(&sent.node, &node);
                    } else {
                        self.incoming.detach(sent.node);
                        self.incoming.nodes.remove(&sent.node);
                    }
                    "return"
                }
                EXIT => {
                    let node = self
                        .outgoing
                        .nodes
                        .remove(&sent.node)
                        .expect("reserved exit storage");
                    user_id = Some(node.user.clone());
                    self.totals.idle = self
                        .totals
                        .idle
                        .checked_add(refund)
                        .expect("exit refund overflow");
                    restored = if refund == sent.amount {
                        sent.claim
                    } else {
                        sent.claim
                            .checked_mul(refund)
                            .expect("restoration product overflow")
                            / sent.amount
                    };
                    let mut user = self.users.get(&node.user).expect("allocated user");
                    user.principal = user
                        .principal
                        .checked_add(restored)
                        .expect("principal restoration overflow");
                    self.totals.principal = self
                        .totals
                        .principal
                        .checked_add(restored)
                        .expect("total restoration overflow");
                    self.users.insert(&node.user, &user);
                    "exit"
                }
                TREASURY => {
                    if used > 0 {
                        self.totals.paid =
                            self.totals.paid.checked_add(used).expect("paid overflow");
                        self.totals.unpaid = self
                            .totals
                            .unpaid
                            .checked_sub(used)
                            .expect("unpaid treasury bound");
                    } else {
                        self.totals.idle = self
                            .totals
                            .idle
                            .checked_add(refund)
                            .expect("treasury refund overflow");
                    }
                    "treasury"
                }
                _ => unreachable!("private cycle record"),
            };
            emit(
                "cash_resolved",
                near_sdk::serde_json::json!({"kind":kind,"user":user_id,"sent":U128(sent.amount),"used":U128(used),"restored_principal":U128(restored)}),
            );
        }
        if self.can_supply() {
            self.supply()
        } else {
            PromiseOrValue::Value(self.finish())
        }
    }
    fn supply(&mut self) -> PromiseOrValue<bool> {
        if self.totals.idle == 0 {
            return PromiseOrValue::Value(self.finish());
        }
        let amount = self.totals.idle;
        self.totals.idle = 0;
        self.cycle.supply = amount;
        self.cycle.phase = 4;
        emit(
            "cash_sent",
            near_sdk::serde_json::json!({"kind":"supply","user":null,"amount":U128(amount),"claim":U128(0)}),
        );
        PromiseOrValue::Promise(call(&self.usdc,"ft_transfer_call",near_sdk::serde_json::json!({"receiver_id":self.rhea,"amount":U128(amount),"msg":""}),1,SUPPLY_GAS)
            .then(self_callback("after_supply",RESOLVE_GAS)))
    }
    pub(crate) fn resolve_supply(&mut self) -> bool {
        if !self.busy || self.cycle.phase != 4 {
            return false;
        }
        let sent = self.cycle.supply;
        let used = result::<U128>(0).map_or(0, |used| used.0.min(sent));
        self.totals.idle = self
            .totals
            .idle
            .checked_add(sent - used)
            .expect("supply refund overflow");
        emit(
            "cash_resolved",
            near_sdk::serde_json::json!({"kind":"supply","user":null,"sent":U128(sent),"used":U128(used),"restored_principal":U128(0)}),
        );
        self.finish()
    }
}
