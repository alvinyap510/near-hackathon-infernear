use crate::queue::NONE;
use near_sdk::{json_types::U128, near};

pub const SCALE: u128 = 1_000_000_000_000_000_000;
pub const INTERNAL_SCALE: u128 = 1_000_000_000_000;
pub const K: usize = 10;

#[near(serializers = [borsh])]
#[derive(Clone, Copy)]
pub struct PendingOut {
    pub amount: u128,
    pub node: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct User {
    pub principal: u128,
    pub snap: u128,
    pub credited_scaled: u128,
    pub nonce: u64,
    pub pending_in: u128,
    pub pending_out: Option<PendingOut>,
}
impl User {
    pub fn settle(&mut self, acc: u128) -> Option<()> {
        let earned = self.principal.checked_mul(acc.checked_sub(self.snap)?)?;
        self.credited_scaled = self.credited_scaled.checked_add(earned)?;
        self.snap = acc;
        Some(())
    }
}

#[near(serializers = [json])]
pub struct Position {
    pub principal: U128,
    pub yield_credited: U128,
    pub pending_in: U128,
    pub pending_out: Option<U128>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Totals {
    pub principal: u128,
    pub acc: u128,
    pub paid: u128,
    pub unpaid: u128,
    pub unattributed_scaled: u128,
    pub idle: u128,
    pub pending_in: u128,
    pub coverage: u128,
}

pub const RETURN: u8 = 1;
pub const EXIT: u8 = 2;
pub const TREASURY: u8 = 3;

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Default)]
pub struct Sent {
    pub kind: u8,
    pub node: u64,
    pub amount: u128,
    pub claim: u128,
}

// Fixed-size callback records reserve their storage at initialization. Returned
// deposit nodes remain allocated until resolution, so refund callbacks never
// compete with a new incoming deposit for storage freed by an in-flight send.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Cycle {
    pub phase: u8,
    pub return_ids: [u64; K],
    pub returns: u8,
    pub exit_ids: [u64; K],
    pub exit_outs: [u128; K],
    pub exits: u8,
    pub pay: u128,
    pub withdraw: u128,
    pub supply: u128,
    pub sent: [Sent; K * 2],
    pub sent_len: u8,
}
impl Default for Cycle {
    fn default() -> Self {
        Self {
            phase: 0,
            return_ids: [NONE; K],
            returns: 0,
            exit_ids: [NONE; K],
            exit_outs: [0; K],
            exits: 0,
            pay: 0,
            withdraw: 0,
            supply: 0,
            sent: [Sent::default(); K * 2],
            sent_len: 0,
        }
    }
}

#[near(serializers = [json])]
pub struct SuppliedEntry {
    pub token_id: near_sdk::AccountId,
    pub balance: U128,
}
#[near(serializers = [json])]
pub struct RheaAccount {
    pub supplied: Vec<SuppliedEntry>,
}
#[near(serializers = [json])]
#[derive(Default)]
pub struct Pool {
    pub balance: U128,
}
#[near(serializers = [json])]
pub struct RheaAsset {
    pub supplied: Pool,
    pub borrowed: Pool,
    pub reserved: U128,
    pub prot_fee: U128,
    pub margin_debt: Pool,
    pub margin_pending_debt: U128,
}
impl RheaAsset {
    pub fn liquidity(&self) -> Option<u128> {
        let total = self
            .supplied
            .balance
            .0
            .checked_add(self.reserved.0)?
            .checked_add(self.prot_fee.0)?;
        let debt = self
            .borrowed
            .balance
            .0
            .checked_add(self.margin_debt.balance.0)?
            .checked_add(self.margin_pending_debt.0)?;
        Some(total.saturating_sub(debt) / INTERNAL_SCALE)
    }
}
