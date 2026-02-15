"use client";

import { useState } from "react";

type ChainType = "ETH" | "SOL";

interface TokenHolding {
  symbol: string;
  name: string;
  balance: string;
  contractAddress: string;
}

interface BalanceResult {
  address: string;
  chain: ChainType;
  date: string;
  balance: string;
  symbol: string;
  blockNumber?: number;
  slot?: number;
  tokens?: TokenHolding[];
  priceUsd?: number | null;
  usdValue?: string | null;
  isHistorical?: boolean;
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<ChainType>("ETH");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BalanceResult | null>(null);
  const [error, setError] = useState("");

  const detectChain = (addr: string): ChainType | null => {
    if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return "ETH";
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return "SOL";
    return null;
  };

  const handleAddressChange = (value: string) => {
    setAddress(value);
    setError("");
    setResult(null);
    const detected = detectChain(value.trim());
    if (detected) setChain(detected);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setResult(null);

    const trimmed = address.trim();
    if (!trimmed) {
      setError("Please enter a wallet address");
      return;
    }
    if (!date) {
      setError("Please select a date");
      return;
    }

    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate > today) {
      setError("Date cannot be in the future");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: trimmed, chain, date }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch balance");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const formatUsd = (value: string) => {
    const num = parseFloat(value);
    return num.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const chainColor = chain === "ETH" ? "var(--eth-color)" : "var(--sol-color)";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        {/* Header */}
        <div className="text-center mb-10">
          <h1
            className="text-[34px] font-bold tracking-tight"
            style={{ color: "var(--label-primary)" }}
          >
            Balance Checker
          </h1>
          <p
            className="mt-1 text-[15px]"
            style={{ color: "var(--label-tertiary)" }}
          >
            Historical ETH & SOL wallet balances
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Network segmented control */}
          <div>
            <p className="ios-section-header mb-2">Network</p>
            <div className="ios-segmented">
              <button
                type="button"
                onClick={() => setChain("ETH")}
                className={`ios-segment cursor-pointer ${
                  chain === "ETH" ? "ios-segment-active" : ""
                }`}
              >
                Ethereum
              </button>
              <button
                type="button"
                onClick={() => setChain("SOL")}
                className={`ios-segment cursor-pointer ${
                  chain === "SOL" ? "ios-segment-active" : ""
                }`}
              >
                Solana
              </button>
            </div>
          </div>

          {/* Grouped inputs card */}
          <div>
            <p className="ios-section-header">Details</p>
            <div className="ios-card">
              {/* Wallet address row */}
              <div className="px-4 py-3">
                <label
                  className="block text-[13px] mb-1.5 font-medium"
                  style={{ color: "var(--label-secondary)" }}
                >
                  Wallet Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  placeholder={
                    chain === "ETH"
                      ? "0x742d35Cc6634C0532925a3b8..."
                      : "7xKXtg2CW87d97TXJSDpbD5j..."
                  }
                  className="ios-input w-full px-3.5 py-2.5 font-mono text-[15px]"
                />
              </div>

              {/* Divider */}
              <div
                className="mx-4"
                style={{ borderTop: "0.33px solid var(--separator)" }}
              />

              {/* Date row */}
              <div className="px-4 py-3">
                <label
                  className="block text-[13px] mb-1.5 font-medium"
                  style={{ color: "var(--label-secondary)" }}
                >
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setError("");
                    setResult(null);
                  }}
                  max={new Date().toISOString().split("T")[0]}
                  className="ios-input w-full px-3.5 py-2.5 text-[15px]"
                />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="ios-error px-4 py-3">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="ios-button w-full py-3.5 cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2.5">
                <span className="ios-spinner" />
                Checking...
              </span>
            ) : (
              "Check Balance"
            )}
          </button>
        </form>

        {/* Results */}
        {result && (
          <div className="mt-8 space-y-5 ios-animate-in">
            {/* Balance hero card */}
            <div className="ios-result-card p-6" data-chain={result.chain}>
              <div className="relative text-center">
                {/* Chain pill */}
                <div className="flex justify-center mb-4">
                  <span
                    className="ios-pill"
                    style={{
                      background:
                        result.chain === "ETH"
                          ? "var(--eth-tint)"
                          : "var(--sol-tint)",
                      color: chainColor,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: chainColor }}
                    />
                    {result.chain === "ETH" ? "Ethereum" : "Solana"}
                  </span>
                </div>

                {/* Main balance */}
                <p className="balance-hero" style={{ color: "var(--label-primary)" }}>
                  {result.balance}
                  <span className="balance-symbol ml-1.5" style={{ color: chainColor }}>
                    {result.symbol}
                  </span>
                </p>

                {/* USD value */}
                {result.usdValue && (
                  <p
                    className="text-[22px] font-medium mt-1"
                    style={{ color: "var(--label-secondary)" }}
                  >
                    {formatUsd(result.usdValue)}
                  </p>
                )}

                {/* Date context */}
                <p
                  className="text-[13px] mt-3"
                  style={{ color: "var(--label-tertiary)" }}
                >
                  {new Date(result.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>

                {/* SOL accuracy warning */}
                {result.chain === "SOL" && result.isHistorical === false && (
                  <div
                    className="mt-4 px-3 py-2 rounded-lg text-[13px]"
                    style={{
                      background: "rgba(255, 159, 10, 0.1)",
                      color: "var(--system-orange)",
                    }}
                  >
                    Approximate - too much history to fully reconstruct
                  </div>
                )}
              </div>
            </div>

            {/* Details card */}
            <div>
              <p className="ios-section-header">Details</p>
              <div className="ios-card">
                {result.priceUsd && (
                  <div className="ios-row">
                    <span className="ios-detail-label">Price</span>
                    <span className="ios-detail-value">
                      $
                      {result.priceUsd.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}
                {result.blockNumber && (
                  <div className="ios-row">
                    <span className="ios-detail-label">Block</span>
                    <span className="ios-detail-value font-mono text-[15px]">
                      {result.blockNumber.toLocaleString()}
                    </span>
                  </div>
                )}
                {result.slot && (
                  <div className="ios-row">
                    <span className="ios-detail-label">Slot</span>
                    <span className="ios-detail-value font-mono text-[15px]">
                      {result.slot.toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="ios-row">
                  <span className="ios-detail-label">Wallet</span>
                  <span
                    className="ios-detail-value font-mono text-[13px] max-w-[200px] truncate"
                    title={result.address}
                  >
                    {result.address}
                  </span>
                </div>
              </div>
            </div>

            {/* Token holdings */}
            {result.tokens && result.tokens.length > 0 && (
              <div>
                <p className="ios-section-header">
                  Token Holdings ({result.tokens.length})
                </p>
                <div className="ios-card">
                  {result.tokens.map((token, i) => (
                    <div key={token.contractAddress}>
                      {i > 0 && (
                        <div
                          className="ml-4"
                          style={{
                            borderTop: "0.33px solid var(--separator)",
                          }}
                        />
                      )}
                      <div className="ios-row">
                        <div>
                          <p
                            className="text-[17px] font-medium"
                            style={{ color: "var(--label-primary)" }}
                          >
                            {token.symbol}
                          </p>
                          <p
                            className="text-[13px]"
                            style={{ color: "var(--label-tertiary)" }}
                          >
                            {token.name}
                          </p>
                        </div>
                        <p
                          className="font-mono text-[15px]"
                          style={{ color: "var(--label-secondary)" }}
                        >
                          {token.balance}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {result.chain === "SOL" && (
                  <p
                    className="text-[12px] mt-2 px-4"
                    style={{ color: "var(--label-quaternary)" }}
                  >
                    Token holdings reflect current balances
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
