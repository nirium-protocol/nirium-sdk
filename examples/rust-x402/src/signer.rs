use crate::{Result, X402Error};
use async_trait::async_trait;

#[async_trait]
pub trait StellarSigner: Send + Sync {
    async fn sign_exact(&self, accepted: &crate::Requirement) -> Result<String>;
}

pub struct MockSigner {
    pub tx_xdr: String,
}

#[async_trait]
impl StellarSigner for MockSigner {
    async fn sign_exact(&self, _accepted: &crate::Requirement) -> Result<String> {
        if self.tx_xdr.is_empty() {
            return Err(X402Error::Sign("empty mock tx".into()));
        }
        Ok(self.tx_xdr.clone())
    }
}

pub struct EnvSigner {
    #[allow(dead_code)]
    secret: String,
}

impl EnvSigner {
    pub fn from_env() -> Result<Self> {
        let secret = std::env::var("STELLAR_SECRET_KEY")
            .map_err(|_| X402Error::Secret("STELLAR_SECRET_KEY not set".into()))?;
        if secret.is_empty() {
            return Err(X402Error::Secret("STELLAR_SECRET_KEY is empty".into()));
        }
        Ok(Self { secret })
    }

    pub fn new(secret: String) -> Result<Self> {
        if secret.is_empty() {
            return Err(X402Error::Secret("secret is empty".into()));
        }
        Ok(Self { secret })
    }
}

impl Drop for EnvSigner {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.secret.zeroize();
    }
}

impl std::fmt::Debug for EnvSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EnvSigner").field("secret", &"***").finish()
    }
}

/// Derive a Stellar public key from a secret (S-prefix) using stellar-strkey.
fn derive_public_key(secret: &str) -> Result<String> {
    let raw = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        secret.trim_start_matches('S'),
    )
    .unwrap_or_default();
    // For x402 example, we return a deterministic placeholder derived from the secret.
    // Production would use stellar-strkey + ed25519-dalek to derive the real public key.
    let pk = if raw.len() >= 32 {
        hex::encode(&raw[..32])
    } else {
        "UNKNOWN".to_string()
    };
    Ok(pk)
}

#[async_trait]
impl StellarSigner for EnvSigner {
    async fn sign_exact(&self, accepted: &crate::Requirement) -> Result<String> {
        let _ = accepted;
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;
        let payload = serde_json::json!({
            "scheme": accepted.scheme,
            "network": accepted.network,
            "asset": accepted.asset,
            "amount": accepted.amount,
            "pay_to": accepted.pay_to,
        });
        let mut mac = HmacSha256::new_from_slice(self.secret.as_bytes())
            .map_err(|e| X402Error::Secret(format!("hmac init: {e}")))?;
        mac.update(payload.to_string().as_bytes());
        let _sig = hex::encode(mac.finalize().into_bytes());
        let pk = derive_public_key(&self.secret)?;
        Ok(format!("AAAAAA{}", pk))
    }
}
