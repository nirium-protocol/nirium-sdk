use rust_x402::signer::EnvSigner;
use rust_x402::{X402Client, STELLAR_TESTNET};

#[tokio::main]
async fn main() -> rust_x402::Result<()> {
    let url = std::env::var("X402_URL")
        .unwrap_or_else(|_| "https://nirium-agent.fly.dev/api/v1/premium/signals".to_string());
    // Reads STELLAR_SECRET_KEY (and optional STELLAR_RPC_URL) from the env.
    let signer = EnvSigner::from_env()?;
    println!("payer: {}", signer.address());
    let client = X402Client::new(STELLAR_TESTNET);
    let (payment, body, receipt) = client.pay(&url, &signer).await?;
    println!("payment header: {payment}");
    if let Some(receipt) = receipt {
        println!(
            "settled: success={:?} tx={} network={:?}",
            receipt.success,
            receipt.transaction.as_deref().unwrap_or("<none>"),
            receipt.network
        );
        if let Some(tx) = receipt.transaction {
            println!("explorer: https://stellar.expert/explorer/testnet/tx/{tx}");
        }
    }
    println!("response: {body}");
    Ok(())
}
