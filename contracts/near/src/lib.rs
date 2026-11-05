use std::collections::BTreeMap;

use near_sdk::{AccountId, PanicOnDefault, env, json_types::U128, near, require, store::LookupMap};

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptSource {
    SignedUsage,
    Reservation,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Receipt {
    pub inference_id: String,
    pub chat_id: String,
    pub model: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub in_price_nano: U128,
    pub out_price_nano: U128,
    pub source: ReceiptSource,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
struct UserState {
    credited: u128,
    spent: u128,
    key_epoch: u32,
}

const RATE_SCALE: u128 = 1_000_000_000_000_000_000;

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Default, PartialEq)]
struct Posting {
    cumulative: u128,
    remainder: u128,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Account {
    pub credited: U128,
    pub spent: U128,
    pub available: U128,
    pub key_epoch: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default, Debug, PartialEq)]
pub struct Vault {
    pub paid_cum: U128,
    pub posted_total: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Connector {
    keeper: AccountId,
    gateway: AccountId,
    users: LookupMap<String, UserState>,
    vaults: LookupMap<String, Vault>,
    posted: LookupMap<(String, String), Posting>,
    debited: LookupMap<String, u128>,
}

#[near]
impl Connector {
    #[init]
    pub fn new(keeper: AccountId, gateway: AccountId) -> Self {
        Self {
            keeper,
            gateway,
            users: LookupMap::new(b"u"),
            vaults: LookupMap::new(b"v"),
            posted: LookupMap::new(b"p"),
            debited: LookupMap::new(b"d"),
        }
    }

    pub fn post_credits(
        &mut self,
        vault: String,
        paid_cum: U128,
        rate: U128,
        source_block: u64,
        entries: Vec<(String, U128)>,
    ) {
        require!(env::predecessor_account_id() == self.keeper, "keeper only");
        let mut state = self.vault(vault.clone());
        state.paid_cum.0 = state.paid_cum.0.max(paid_cum.0);

        // Stage the whole batch, including repeated users, before any storage write.
        let mut updates: BTreeMap<String, (Posting, UserState)> = BTreeMap::new();
        for (user, cumulative) in &entries {
            let (posted, account) = updates.entry(user.clone()).or_insert_with(|| {
                (
                    self.posted
                        .get(&(vault.clone(), user.clone()))
                        .copied()
                        .unwrap_or_default(),
                    self.users.get(user).cloned().unwrap_or_default(),
                )
            });
            let delta = cumulative
                .0
                .checked_sub(posted.cumulative)
                .expect("negative credit delta");
            let priced = delta
                .checked_mul(rate.0)
                .and_then(|value| value.checked_add(posted.remainder))
                .expect("priced credit overflow");
            account.credited = account
                .credited
                .checked_add(priced / RATE_SCALE)
                .expect("credit overflow");
            state.posted_total.0 = state
                .posted_total
                .0
                .checked_add(delta)
                .expect("posted total overflow");
            posted.cumulative = cumulative.0;
            posted.remainder = priced % RATE_SCALE;
        }
        require!(
            state.posted_total.0 <= state.paid_cum.0,
            "posting exceeds paid_cum"
        );

        let mut changed = state != self.vault(vault.clone());
        for (user, (posted, account)) in updates {
            let key = (vault.clone(), user.clone());
            if posted != self.posted.get(&key).copied().unwrap_or_default() {
                self.posted.insert(key, posted);
                self.users.insert(user, account);
                changed = true;
            }
        }
        if changed {
            self.vaults.insert(vault.clone(), state.clone());
            emit(
                "post_credits",
                near_sdk::serde_json::json!({
                    "vault": vault, "paid_cum": state.paid_cum, "rate": rate, "source_block": source_block, "entries": entries
                }),
            );
        }
    }

    pub fn debit(&mut self, user: String, amount_micro: U128, receipt: Receipt) {
        require!(
            env::predecessor_account_id() == self.gateway,
            "gateway only"
        );
        if self.debited.contains_key(&receipt.inference_id) {
            return;
        }
        let mut account = self.users.get(&user).cloned().unwrap_or_default();
        account.spent = account
            .spent
            .checked_add(amount_micro.0)
            .expect("spent overflow");
        require!(account.spent <= account.credited, "insufficient credit");
        self.users.insert(user.clone(), account);
        self.debited
            .insert(receipt.inference_id.clone(), amount_micro.0);
        emit(
            "debit",
            near_sdk::serde_json::json!({
                "user": user, "amount_micro": amount_micro, "receipt": receipt
            }),
        );
    }

    pub fn bump_key_epoch(&mut self, user: String) -> u32 {
        require!(
            env::predecessor_account_id() == self.gateway,
            "gateway only"
        );
        let mut account = self.users.get(&user).cloned().unwrap_or_default();
        account.key_epoch = account
            .key_epoch
            .checked_add(1)
            .expect("key epoch overflow");
        let epoch = account.key_epoch;
        self.users.insert(user.clone(), account);
        emit(
            "key_epoch",
            near_sdk::serde_json::json!({"user": user, "key_epoch": epoch}),
        );
        epoch
    }

    pub fn account(&self, user: String) -> Account {
        let state = self.users.get(&user).cloned().unwrap_or_default();
        Account {
            credited: U128(state.credited),
            spent: U128(state.spent),
            available: U128(state.credited - state.spent),
            key_epoch: state.key_epoch,
        }
    }

    pub fn debited_amount(&self, inference_id: String) -> Option<U128> {
        self.debited.get(&inference_id).copied().map(U128)
    }

    pub fn vault(&self, vault: String) -> Vault {
        self.vaults.get(&vault).cloned().unwrap_or_default()
    }
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "infernear", "version": "1.0.0", "event": event, "data": [data]
        })
    ));
}

#[cfg(test)]
mod tests;
