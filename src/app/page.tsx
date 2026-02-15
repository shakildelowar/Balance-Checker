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

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold mb-1 tracking-tight text-white/95">
            Balance Checker
          </h1>
          <p className="text-[var(--muted)] text-sm tracking-tight">
            Check any ETH or SOL wallet balance at a specific date
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="glass-card relative rounded-2xl p-6 space-y-5"
        >
          {/* Chain selector */}
          <div>
            <label className="block text-sm font-medium mb-2 text-white/70">
              Network
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setChain("ETH")}
                className={`py-3 rounded-xl text-sm font-medium cursor-pointer ${
                  chain === "ETH" ? "chain-btn-active-eth" : "chain-btn text-white/40 hover:text-white/70"
                }`}
              >
                Ethereum (ETH)
              </button>
              <button
                type="button"
                onClick={() => setChain("SOL")}
                className={`py-3 rounded-xl text-sm font-medium cursor-pointer ${
                  chain === "SOL" ? "chain-btn-active-sol" : "chain-btn text-white/40 hover:text-white/70"
                }`}
              >
                Solana (SOL)
              </button>
            </div>
          </div>

          {/* Wallet address */}
          <div>
            <label className="block text-sm font-medium mb-2 text-white/70">
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
              className="glass-input w-full px-4 py-3 rounded-xl text-white placeholder:text-white/20 focus:outline-none text-sm font-mono"
            />
          </div>

          {/* Date picker */}
          <div>
            <label className="block text-sm font-medium mb-2 text-white/70">
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
              className="glass-input w-full px-4 py-3 rounded-xl text-white focus:outline-none text-sm"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="glass-button w-full py-3 rounded-xl font-medium text-white cursor-pointer"
          >
            {loading ? "Checking..." : "Check Balance"}
          </button>
        </form>

        {/* Result */}
        {result && (
          <div className="mt-6 space-y-4">
            {/* Native balance */}
            <div className="glass-result relative rounded-2xl p-6">
              <div className="text-center">
                <p className="text-white/40 text-sm mb-1">
                  Balance on{" "}
                  {new Date(result.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
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

                {/* USD value */}
                {result.usdValue && (
                  <p className="text-white/50 text-lg mt-1">
                    {formatUsd(result.usdValue)}
                  </p>
                )}
                {result.priceUsd && (
                  <p className="text-white/30 text-xs mt-1">
                    @ ${result.priceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per {result.symbol}
                  </p>
                )}

                <p className="text-white/25 text-xs mt-3 font-mono break-all">
                  {result.address}
                </p>
                {result.blockNumber && (
                  <p className="text-white/25 text-xs mt-1">
                    Block #{result.blockNumber.toLocaleString()}
                  </p>
                )}

                {/* SOL accuracy note */}
                {result.chain === "SOL" && result.isHistorical === false && (
                  <p className="text-amber-400/70 text-xs mt-3 bg-amber-400/5 border border-amber-400/10 rounded-lg px-3 py-2">
                    Approximate - wallet has too much history to fully reconstruct
                  </p>
                )}
              </div>
            </div>

            {/* Token breakdown */}
            {result.tokens && result.tokens.length > 0 && (
              <div className="glass-card relative rounded-2xl p-6">
                <h3 className="text-sm font-medium text-white/40 mb-4">
                  Token Holdings ({result.tokens.length})
                </h3>
                <div className="space-y-1">
                  {result.tokens.map((token) => (
                    <div
                      key={token.contractAddress}
                      className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-white/90">
                          {token.symbol}
                        </p>
                        <p className="text-xs text-white/30">{token.name}</p>
                      </div>
                      <p className="text-sm font-mono text-white/70">
                        {token.balance}
                      </p>
                    </div>
                  ))}
                </div>
                {result.chain === "SOL" && (
                  <p className="text-white/20 text-xs mt-4 text-center">
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
