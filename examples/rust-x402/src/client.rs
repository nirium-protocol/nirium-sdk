use crate::signer::StellarSigner;
use crate::types::{payment_header, Challenge};
use crate::{Result, X402Error};
use reqwest::Client;

/// Decoded `payment-response` header from a settled x402 v2 payment.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PaymentReceipt {
    pub success: Option<bool>,
    pub payer: Option<String>,
    /// Transaction hash on the payment network (resolves on stellar.expert).
    pub transaction: Option<String>,
    pub network: Option<String>,
}

pub struct X402Client {
    http: Client,
    network: String,
}

impl X402Client {
    pub fn new(network: &str) -> Self {
        Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("build http client"),
            network: network.to_string(),
        }
    }

    pub async fn get(&self, url: &str) -> Result<reqwest::Response> {
        let resp = self.http.get(url).send().await?;
        Ok(resp)
    }

    /// Runs the full 402 → sign → PAYMENT-SIGNATURE → retry loop.
    ///
    /// Returns the payment credential header, the decoded JSON body, and the
    /// settlement receipt (tx hash) when the server sent `payment-response`.
    pub async fn pay(
        &self,
        url: &str,
        signer: &dyn StellarSigner,
    ) -> Result<(String, serde_json::Value, Option<PaymentReceipt>)> {
        let first = self.http.get(url).send().await?;
        if first.status() != reqwest::StatusCode::PAYMENT_REQUIRED {
            return Err(X402Error::MockTest(format!(
                "expected 402, got {}",
                first.status()
            )));
        }
        let header = first
            .headers()
            .get(crate::types::PAYMENT_REQUIRED_HEADER)
            .ok_or(X402Error::MissingHeader)?
            .to_str()
            .map_err(|e| X402Error::Decode(e.to_string()))?
            .to_string();
        let challenge = Challenge::parse(&header)?;
        let accepted = challenge.select_exact(&self.network)?;
        let tx = signer.sign_exact(&accepted).await?;
        let payment = payment_header(&challenge, accepted, &tx)?;
        let resp = self
            .http
            .get(url)
            .header(crate::types::PAYMENT_SIGNATURE_HEADER, &payment)
            .send()
            .await?;
        let receipt = resp
            .headers()
            .get("payment-response")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, v).ok())
            .and_then(|bytes| serde_json::from_slice::<PaymentReceipt>(&bytes).ok());
        let status = resp.status();
        if !status.is_success() {
            return Err(X402Error::MockTest(format!("retry failed: {status}")));
        }
        let body = resp.json::<serde_json::Value>().await?;
        Ok((payment, body, receipt))
    }
}
