// near-sdk generates an eight-argument wrapper for the fixed seven-field constructor.
#![allow(clippy::too_many_arguments)]

mod auth;
mod engine;
mod queue;
mod state;

use auth::{Withdrawal, owner_address, valid_user};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
    collections::{LookupMap, Vector},
    env,
    json_types::U128,
    near, require,
};
use queue::Queue;
use state::*;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RheaUsdcVault {
    usdc: AccountId,
    rhea: AccountId,
    intents: AccountId,
    treasury: AccountId,
    cushion: u128,
    min_deposit: u128,
    cap: u128,
    users: LookupMap<String, User>,
    holders: Vector<String>,
    incoming: Queue,
    outgoing: Queue,
    totals: Totals,
    busy: bool,
    cycle: Cycle,
}

#[near]
impl RheaUsdcVault {
    #[init]
    pub fn new(
        usdc: AccountId,
        rhea: AccountId,
        intents: AccountId,
        treasury: AccountId,
        cushion: U128,
        min_deposit: U128,
        cap: U128,
    ) -> Self {
        Self {
            usdc,
            rhea,
            intents,
            treasury,
            cushion: cushion.0,
            min_deposit: min_deposit.0,
            cap: cap.0,
            users: LookupMap::new(b"u"),
            holders: Vector::new(b"h"),
            incoming: Queue::new(b"i"),
            outgoing: Queue::new(b"o"),
            totals: Totals {
                idle: cushion.0,
                coverage: SCALE,
                ..Totals::default()
            },
            busy: false,
            cycle: Cycle::default(),
        }
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let _ = sender_id;
        #[derive(near_sdk::serde::Deserialize)]
        #[serde(crate = "near_sdk::serde")]
        struct Deposit {
            user: String,
        }
        if env::predecessor_account_id() != self.usdc
            || amount.0 == 0
            || amount.0 < self.min_deposit
        {
            return amount;
        }
        let Ok(Deposit { user }) = near_sdk::serde_json::from_str(&msg) else {
            return amount;
        };
        if !valid_user(&user) {
            return amount;
        }
        let Some(pending) = self.totals.pending_in.checked_add(amount.0) else {
            return amount;
        };
        let existing = self.users.get(&user);
        let mut record = existing.clone().unwrap_or(User {
            snap: self.totals.acc,
            ..User::default()
        });
        let Some(user_pending) = record.pending_in.checked_add(amount.0) else {
            return amount;
        };
        // Borsh keys/values + NEAR's 40-byte record overhead. All cycle records
        // are fixed-size at init; only an optional exit is allocated by a later
        // normal transaction. No promise or balance read occurs in this receiver.
        let node_bytes = 1
            + 8
            + near_sdk::borsh::to_vec(&queue::Node {
                user: user.clone(),
                amount: amount.0,
                next: queue::NONE,
            })
            .expect("serialize node")
            .len()
            + 40;
        let user_bytes = if existing.is_none() {
            1 + 4
                + user.len()
                + near_sdk::borsh::to_vec(&record)
                    .expect("serialize user")
                    .len()
                + 40
                + 1
                + 8
                + 4
                + user.len()
                + 40
        } else {
            0
        };
        let Some(required) = (env::storage_usage() as u128)
            .checked_add((node_bytes + user_bytes) as u128)
            .and_then(|bytes| bytes.checked_mul(env::storage_byte_cost().as_yoctonear()))
        else {
            return amount;
        };
        if env::account_balance().as_yoctonear() < required {
            return amount;
        }
        record.pending_in = user_pending;
        if existing.is_none() {
            self.holders.push(&user);
        }
        self.users.insert(&user, &record);
        self.incoming.append(user.clone(), amount.0);
        self.totals.pending_in = pending;
        emit(
            "deposit_queued",
            near_sdk::serde_json::json!({"user":user,"amount":amount}),
        );
        U128(0)
    }

    pub fn request_withdraw(&mut self, message: String, signature: String) {
        require!(!self.busy, "vault busy");
        let request: Withdrawal =
            near_sdk::serde_json::from_str(&message).expect("invalid withdrawal message");
        require!(
            request.action == "withdraw"
                && request.network == "mainnet"
                && request.vault == env::current_account_id(),
            "wrong withdrawal domain"
        );
        require!(valid_user(&request.user), "invalid user");
        require!(
            request.expires_at > env::block_timestamp() / 1_000_000_000,
            "withdrawal expired"
        );
        require!(
            auth::recover(&message, &signature).as_deref() == Some(owner_address(&request.user)),
            "invalid withdrawal signature"
        );
        let mut user = self.users.get(&request.user).expect("unknown user");
        require!(request.nonce == user.nonce, "wrong nonce");
        require!(
            request.amount.0 > 0 && request.amount.0 <= user.principal,
            "invalid withdrawal amount"
        );
        user.nonce = user.nonce.checked_add(1).expect("nonce overflow");
        let node = if let Some(previous) = user.pending_out {
            let mut node = self
                .outgoing
                .nodes
                .get(&previous.node)
                .expect("missing pending request");
            node.amount = request.amount.0;
            self.outgoing.nodes.insert(&previous.node, &node);
            previous.node
        } else {
            self.outgoing.append(request.user.clone(), request.amount.0)
        };
        user.pending_out = Some(PendingOut {
            amount: request.amount.0,
            node,
        });
        self.users.insert(&request.user, &user);
        emit(
            "withdraw_requested",
            near_sdk::serde_json::json!({"user":request.user,"amount":request.amount,"nonce":request.nonce}),
        );
    }

    pub fn run(&mut self) -> Promise {
        require!(!self.busy, "vault busy");
        require!(
            env::prepaid_gas() >= Gas::from_tgas(300),
            "run requires 300 Tgas"
        );
        self.busy = true;
        self.cycle = Cycle {
            phase: 1,
            ..Cycle::default()
        };
        call(
            &self.rhea,
            "get_account",
            near_sdk::serde_json::json!({"account_id":env::current_account_id()}),
            0,
            5,
        )
        .and(call(
            &self.rhea,
            "get_asset",
            near_sdk::serde_json::json!({"token_id":self.usdc}),
            0,
            5,
        ))
        .then(self_callback("after_measure", 240))
    }

    #[private]
    pub fn after_measure(&mut self) -> PromiseOrValue<bool> {
        self.measure_and_plan()
    }
    #[private]
    pub fn after_withdraw(&mut self) -> PromiseOrValue<bool> {
        self.withdraw_and_send()
    }
    #[private]
    pub fn after_send(&mut self) -> bool {
        self.resolve_sends()
    }
    #[private]
    pub fn after_supply(&mut self) -> bool {
        self.resolve_supply()
    }

    pub fn position(&self, user: String) -> Position {
        let mut record = self.users.get(&user).unwrap_or_default();
        record
            .settle(self.totals.acc)
            .expect("entitlement overflow");
        Position {
            principal: U128(record.principal),
            yield_credited: U128(record.credited_scaled / SCALE),
            pending_in: U128(record.pending_in),
            pending_out: record.pending_out.map(|p| U128(p.amount)),
        }
    }
    pub fn idle(&self) -> U128 {
        U128(self.totals.idle)
    }
    pub fn paid_total(&self) -> U128 {
        U128(self.totals.paid)
    }
    pub fn unpaid(&self) -> U128 {
        U128(self.totals.unpaid)
    }
    pub fn unattributed(&self) -> U128 {
        U128(self.totals.unattributed_scaled / SCALE)
    }
    pub fn coverage(&self) -> U128 {
        U128(self.totals.coverage)
    }
    pub fn nonce(&self, user: String) -> u64 {
        self.users.get(&user).map_or(0, |u| u.nonce)
    }
    pub fn busy(&self) -> bool {
        self.busy
    }
    pub fn holders(&self, from: u64, limit: u64) -> Vec<String> {
        (from..from.saturating_add(limit).min(self.holders.len()))
            .filter_map(|i| self.holders.get(i))
            .collect()
    }
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({"standard":"infernear","version":"1.0.0","event":event,"data":[data]})
    ));
}
fn call(
    account: &AccountId,
    method: &str,
    args: near_sdk::serde_json::Value,
    deposit: u128,
    gas: u64,
) -> Promise {
    Promise::new(account.clone()).function_call(
        method,
        near_sdk::serde_json::to_vec(&args).expect("serialize arguments"),
        NearToken::from_yoctonear(deposit),
        Gas::from_tgas(gas),
    )
}
fn self_callback(method: &str, gas: u64) -> Promise {
    call(
        &env::current_account_id(),
        method,
        near_sdk::serde_json::json!({}),
        0,
        gas,
    )
}

#[cfg(test)]
mod tests;
