// LOCAL SANDBOX FIXTURE ONLY: unrestricted minting/configuration, never mainnet.
use near_contract_standards::fungible_token::{
    FungibleToken, core::FungibleTokenCore, receiver::FungibleTokenReceiver,
    resolver::FungibleTokenResolver,
};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, collections::LookupMap,
    env, json_types::U128, near,
};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Mock {
    role: String,
    usdc: AccountId,
    token: FungibleToken,
    balances: LookupMap<String, u128>,
    total: u128,
    refund_all: bool,
    liquidity: Option<u128>,
}
#[near]
impl Mock {
    #[init]
    pub fn new(role: String, usdc: AccountId) -> Self {
        Self {
            role,
            usdc,
            token: FungibleToken::new(b"t"),
            balances: LookupMap::new(b"b"),
            total: 0,
            refund_all: false,
            liquidity: None,
        }
    }
    pub fn set_liquidity(&mut self, amount: U128) {
        self.liquidity = Some(amount.0);
    }
    pub fn return_all_deposits(&mut self) {
        self.refund_all = true;
    }
    pub fn accept_deposits(&mut self) {
        self.refund_all = false;
    }
    pub fn register(&mut self, account_id: AccountId) {
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
    }
    pub fn unregister_empty(&mut self, account_id: AccountId) {
        assert_eq!(self.token.ft_balance_of(account_id.clone()).0, 0);
        self.token.accounts.remove(&account_id);
    }
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        self.register(account_id.clone());
        self.token.internal_deposit(&account_id, amount.0);
    }
    pub fn add_yield(&mut self, account_id: AccountId, amount: U128) {
        let id = account_id.to_string();
        let balance = self.balances.get(&id).unwrap_or(0);
        self.balances.insert(&id, &(balance + amount.0));
        self.total += amount.0;
    }
    pub fn get_account(&self, account_id: AccountId) -> near_sdk::serde_json::Value {
        let balance = self.balances.get(&account_id.to_string()).unwrap_or(0);
        let account = near_sdk::serde_json::json!({
            "account_id":account_id,
            "supplied":if balance == 0 { vec![] } else { vec![near_sdk::serde_json::json!({"token_id":self.usdc,"shares":(balance*1_000_000_000_000u128).to_string(),"balance":(balance*1_000_000_000_000u128).to_string(),"apr":"0.100485435396468792399511703"})] },
            "collateral":[],"borrowed":[],
            "farms":if balance == 0 { vec![] } else { vec![near_sdk::serde_json::json!({"farm_id":{"TokenNetBalance":self.usdc},"rewards":{"mock-reward.test.near":{"boosted_shares":"1000000000000000000000000000","unclaimed_amount":"1000000000000000000000000","last_reward_per_share":"1000000000000000000000000000"}}})] },
            "has_non_farmed_assets":false,"booster_staking":null,"booster_stakings":{}
        });
        self.view_work("get_account", &account, if balance == 0 { 3 } else { 6 });
        account
    }
    pub fn get_asset(&self, token_id: AccountId) -> near_sdk::serde_json::Value {
        assert_eq!(token_id, self.usdc);
        let borrowed = self
            .total
            .saturating_sub(self.liquidity.unwrap_or(self.total));
        let mut asset: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(include_str!("asset-view.json")).unwrap();
        asset["token_id"] = near_sdk::serde_json::json!(self.usdc);
        asset["supplied"] = near_sdk::serde_json::json!({"shares":(self.total*1_000_000_000_000u128).to_string(),"balance":(self.total*1_000_000_000_000u128).to_string()});
        asset["borrowed"] = near_sdk::serde_json::json!({"shares":(borrowed*1_000_000_000_000u128).to_string(),"balance":(borrowed*1_000_000_000_000u128).to_string()});
        for field in ["reserved", "prot_fee", "margin_pending_debt"] {
            asset[field] = near_sdk::serde_json::json!("0");
        }
        asset["farms"][0]["farm_id"]["TokenNetBalance"] = near_sdk::serde_json::json!(self.usdc);
        self.view_work("get_asset", &asset, 6);
        asset
    }
    fn view_work(&self, method: &str, value: &near_sdk::serde_json::Value, tgas: u64) {
        // Local-only emulation of Rhea computation, in addition to realistic
        // config/farm serialization. A tiny constant response missed the 5 Tgas bug.
        let bytes = near_sdk::serde_json::to_vec(value).unwrap();
        while env::used_gas() < Gas::from_tgas(tgas) {
            let _ = env::sha256(&bytes);
        }
        env::log_str(&format!(
            "MOCK_VIEW:{}",
            near_sdk::serde_json::json!({"method":method,"bytes":bytes.len(),"prepaid":env::prepaid_gas().as_gas()})
        ));
    }
    pub fn received(&self, user: String) -> U128 {
        U128(self.balances.get(&user).unwrap_or(0))
    }
    #[payable]
    pub fn simple_withdraw(
        &mut self,
        token_id: AccountId,
        amount_with_inner_decimal: U128,
        recipient_id: AccountId,
    ) -> Promise {
        assert_eq!(token_id, self.usdc);
        near_sdk::assert_one_yocto();
        let owner = env::predecessor_account_id().to_string();
        let amount = amount_with_inner_decimal.0 / 1_000_000_000_000;
        assert!(amount > 0);
        let balance = self.balances.get(&owner).unwrap_or(0);
        assert!(balance >= amount);
        self.balances.insert(&owner, &(balance - amount));
        self.total -= amount;
        Promise::new(self.usdc.clone()).function_call("ft_transfer",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"receiver_id":recipient_id,"amount":U128(amount)})).unwrap(),NearToken::from_yoctonear(1),Gas::from_tgas(10))
            .then(Promise::new(env::current_account_id()).function_call("after_withdraw",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"owner":owner,"amount":U128(amount)})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(10)))
    }
    #[private]
    pub fn after_withdraw(&mut self, owner: String, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 100).is_ok();
        if !ok {
            let balance = self.balances.get(&owner).unwrap_or(0);
            self.balances.insert(&owner, &(balance + amount.0));
            self.total += amount.0;
        }
        ok
    }
}
#[near]
impl FungibleTokenCore for Mock {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}
#[near]
impl FungibleTokenResolver for Mock {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}
#[near]
impl FungibleTokenReceiver for Mock {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_eq!(env::predecessor_account_id(), self.usdc);
        if self.refund_all {
            return PromiseOrValue::Value(amount);
        }
        let owner = if self.role == "rhea" {
            sender_id.to_string()
        } else {
            msg
        };
        let balance = self.balances.get(&owner).unwrap_or(0);
        self.balances.insert(&owner, &(balance + amount.0));
        self.total += amount.0;
        PromiseOrValue::Value(U128(0))
    }
}
