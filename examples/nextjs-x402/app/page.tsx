export default function Home() {
  return (
    <main>
      <h1>Nirium x402 Next.js example</h1>
      <p>
        Call <code>/api/premium/signals</code> to receive an x402 payment
        challenge, then retry with an <code>X-PAYMENT</code> header.
      </p>
    </main>
  );
}
