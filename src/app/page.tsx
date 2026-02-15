"use client";

import { useState } from "react";

type ChainType = "ETH" | "SOL";

interface BalanceResult {
  address: string;
  chain: ChainType;
  date: string;
  balance: string;
  symbol: string;
  blockNumber?: number;
  slot?: number;
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

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Balance Checker</h1>
          <p className="text-[var(--muted)]">
            Check any ETH or SOL wallet balance at a specific date
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 space-y-5"
        >
          {/* Chain selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Network</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setChain("ETH")}
                className={`py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  chain === "ETH"
                    ? "bg-[var(--eth-color)] text-white"
                    : "bg-[var(--background)] text-[var(--muted)] hover:text-white border border-[var(--card-border)]"
                }`}
              >
                Ethereum (ETH)
              </button>
              <button
                type="button"
                onClick={() => setChain("SOL")}
                className={`py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  chain === "SOL"
                    ? "bg-[var(--sol-color)] text-white"
                    : "bg-[var(--background)] text-[var(--muted)] hover:text-white border border-[var(--card-border)]"
                }`}
              >
                Solana (SOL)
              </button>
            </div>
          </div>

          {/* Wallet address */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Wallet Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => handleAddressChange(e.target.value)}
              placeholder={
                chain === "ETH"
                  ? "0x742d35Cc6634C0532925a3b844..."
                  : "7xKXtg2CW87d97TXJSDpbD5jBk..."
              }
              className="w-full px-4 py-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-white placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors text-sm font-mono"
            />
          </div>

          {/* Date picker */}
          <div>
            <label className="block text-sm font-medium mb-2">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setError("");
                setResult(null);
              }}
              max={new Date().toISOString().split("T")[0]}
              className="w-full px-4 py-3 rounded-xl bg-[var(--background)] border border-[var(--card-border)] text-white focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-xl font-medium transition-all cursor-pointer ${
              loading
                ? "bg-[var(--accent)]/50 text-white/50 cursor-not-allowed"
                : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
            }`}
          >
            {loading ? "Checking..." : "Check Balance"}
          </button>
        </form>

        {/* Result */}
        {result && (
          <div className="mt-6 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <div className="text-center">
              <p className="text-[var(--muted)] text-sm mb-1">
                Balance on {new Date(result.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
              <p className="text-4xl font-bold mt-2">
                {result.balance}{" "}
                <span
                  className={
                    result.chain === "ETH"
                      ? "text-[var(--eth-color)]"
                      : "text-[var(--sol-color)]"
                  }
                >
                  {result.symbol}
                </span>
              </p>
              <p className="text-[var(--muted)] text-xs mt-3 font-mono break-all">
                {result.address}
              </p>
              {result.blockNumber && (
                <p className="text-[var(--muted)] text-xs mt-1">
                  Block #{result.blockNumber.toLocaleString()}
                </p>
              )}
              {result.slot && (
                <p className="text-[var(--muted)] text-xs mt-1">
                  Slot #{result.slot.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
