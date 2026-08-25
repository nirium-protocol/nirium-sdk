use rust_x402::{X402Client, STELLAR_TESTNET};
use rust_x402::signer::EnvSigner;
use rust_x402::StellarSigner;

#[tokio::main]
async fn main() -> rust_x402::Result<()> {
    let url = std::env::var("X402_URL")
        .unwrap_or_else(|_| "https://nirium-agent.fly.dev/api/v1/premium/signals".to_string());
    let signer = EnvSigner::new("SD_TESTNET_SECRET_HERE".to_string())?;
    let client = X402Client::new(STELLAR_TESTNET);
    let (payment, body) = client.pay(&url, &signer).await?;
    println!("payment header: {payment}");
    println!("response: {body}");
    Ok(())
}
