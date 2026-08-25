use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub const PAYMENT_REQUIRED_HEADER: &str = "payment-required";
pub const PAYMENT_SIGNATURE_HEADER: &str = "PAYMENT-SIGNATURE";
pub const STELLAR_TESTNET: &str = "stellar:testnet";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Requirement {
    pub scheme: String,
    pub network: String,
    pub asset: String,
    pub amount: String,
    #[serde(rename = "payTo")]
    pub pay_to: String,
    #[serde(rename = "maxTimeoutSeconds")]
    pub max_timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Challenge {
    #[serde(rename = "x402Version")]
    pub x402_version: i64,
    pub accepts: Vec<Requirement>,
}

impl Challenge {
    pub fn parse(header_value: &str) -> crate::Result<Self> {
        if header_value.is_empty() {
            return Err(crate::X402Error::MissingHeader);
        }
        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            header_value,
        )
        .map_err(|e| crate::X402Error::Decode(e.to_string()))?;
        let challenge: Challenge =
            serde_json::from_slice(&bytes).map_err(|e| crate::X402Error::Parse(e.to_string()))?;
        if challenge.x402_version != 2 {
            return Err(crate::X402Error::UnsupportedVersion(challenge.x402_version));
        }
        if challenge.accepts.is_empty() {
            return Err(crate::X402Error::NoAccepts);
        }
        Ok(challenge)
    }

    pub fn select_exact(&self, network: &str) -> crate::Result<Requirement> {
        self.accepts
            .iter()
            .find(|r| r.scheme == "exact" && r.network == network)
            .cloned()
            .ok_or_else(|| crate::X402Error::NoExactForNetwork(network.to_string()))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Payment {
    #[serde(rename = "x402Version")]
    pub x402_version: i64,
    pub accepted: Requirement,
    pub payload: PaymentPayload,
}

#[derive(Debug, Clone, Serialize)]
pub struct PaymentPayload {
    pub transaction: String,
}

impl Payment {
    pub fn header_value(&self) -> crate::Result<String> {
        if self.payload.transaction.is_empty() {
            return Err(crate::X402Error::EmptyTransaction);
        }
        let json = serde_json::to_vec(self).map_err(|e| crate::X402Error::Parse(e.to_string()))?;
        Ok(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            json,
        ))
    }
}

pub fn payment_header(
    challenge: &Challenge,
    accepted: Requirement,
    transaction: &str,
) -> crate::Result<String> {
    let payment = Payment {
        x402_version: challenge.x402_version,
        accepted,
        payload: PaymentPayload {
            transaction: transaction.to_string(),
        },
    };
    payment.header_value()
}
