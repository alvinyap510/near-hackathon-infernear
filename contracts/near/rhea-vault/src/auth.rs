use near_sdk::{AccountId, env, json_types::U128, near};

pub const USER_PREFIX: &str = "eip155:8453:0x"; // Confirmed Base-only owner namespace.

#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
pub struct Withdrawal {
    pub action: String,
    pub network: String,
    pub vault: AccountId,
    pub user: String,
    pub amount: U128,
    pub nonce: u64,
    pub expires_at: u64,
}

pub fn valid_user(user: &str) -> bool {
    user.strip_prefix(USER_PREFIX).is_some_and(|address| {
        address.len() == 40
            && address
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    })
}

pub fn owner_address(user: &str) -> &str {
    &user[USER_PREFIX.len() - 2..]
}

pub fn recover(message: &str, signature: &str) -> Option<String> {
    let signature = signature.strip_prefix("0x").unwrap_or(signature);
    if signature.len() != 130 {
        return None;
    }
    let bytes: Option<Vec<u8>> = signature
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            std::str::from_utf8(pair)
                .ok()
                .and_then(|s| u8::from_str_radix(s, 16).ok())
        })
        .collect();
    let bytes = bytes?;
    let v = match bytes[64] {
        0 | 1 => bytes[64],
        27 | 28 => bytes[64] - 27,
        _ => return None,
    };
    let mut preimage = b"\x19Ethereum Signed Message:\n".to_vec();
    preimage.extend_from_slice(message.len().to_string().as_bytes());
    preimage.extend_from_slice(message.as_bytes());
    let key = env::ecrecover(&env::keccak256(&preimage), &bytes[..64], v, true)?;
    let hash = env::keccak256(key);
    Some(format!(
        "0x{}",
        hash[12..]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}
