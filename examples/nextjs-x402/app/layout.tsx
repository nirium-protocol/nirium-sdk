import type { ReactNode } from "react";

export const metadata = {
  title: "Nirium x402 Next.js example",
  description: "Paid Route Handler example for Nirium x402 payments",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
