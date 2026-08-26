import React from "react";

export const metadata = {
  title: "x402 Vercel API Template — Nirium",
  description: "One-click Vercel deployment template for x402 pay-per-request APIs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", margin: 0, padding: "2rem", backgroundColor: "#0f172a", color: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}
