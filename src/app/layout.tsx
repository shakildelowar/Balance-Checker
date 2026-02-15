import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Balance Checker",
  description: "Check historical ETH and SOL wallet balances",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
