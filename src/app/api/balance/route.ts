import { NextRequest, NextResponse } from "next/server";

const ETHERSCAN_API = "https://api.etherscan.io/api";
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || "";
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

function etherscanParams(extra: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (ETHERSCAN_KEY) params.set("apikey", ETHERSCAN_KEY);
  return params.toString();
}

// ── Price helpers ───────────────────────────────────────────────────────

async function getHistoricalPrice(
  coinId: string,
  dateStr: string
): Promise<number | null> {
  // CoinGecko expects dd-mm-yyyy
  const [year, month, day] = dateStr.split("-");
  const formatted = `${day}-${month}-${year}`;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${formatted}&localization=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.market_data?.current_price?.usd ?? null;
  } catch {
    return null;
  }
}

// ── ETH helpers ─────────────────────────────────────────────────────────

const ETH_RPC_ENDPOINTS = [
  process.env.ETH_RPC_URL,
  "https://rpc.ankr.com/eth",
  "https://eth.llamarpc.com",
  "https://1rpc.io/eth",
  "https://ethereum-rpc.publicnode.com",
].filter(Boolean) as string[];

async function ethRpc(method: string, params: unknown[]) {
  let lastError: Error | null = null;

  for (const rpc of ETH_RPC_ENDPOINTS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        lastError = new Error(`RPC ${rpc} returned non-JSON response`);
        continue;
      }

      const data = await res.json();
      if (data.error) {
        lastError = new Error(data.error.message || "RPC error");
        continue;
      }
      return data;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error("RPC request failed");
      continue;
    }
  }

  throw lastError || new Error("All ETH RPC endpoints failed");
}

async function getBlockTimestamp(blockNum: number): Promise<number> {
  const hex = "0x" + blockNum.toString(16);
  const data = await ethRpc("eth_getBlockByNumber", [hex, false]);
  if (!data.result) throw new Error("Block not found");
  return parseInt(data.result.timestamp, 16);
}

async function getEthBlockByTimestamp(timestamp: number): Promise<number> {
  // Try Etherscan first if API key is available
  if (ETHERSCAN_KEY) {
    try {
      const qs = etherscanParams({
        module: "block",
        action: "getblocknobytime",
        timestamp: String(timestamp),
        closest: "before",
      });
      const res = await fetch(`${ETHERSCAN_API}?${qs}`);
      const data = await res.json();
      if (data.status === "1") {
        return parseInt(data.result, 10);
      }
    } catch {
      // Fall through to binary search
    }
  }

  // Binary search using RPC (no API key needed)
  const latestData = await ethRpc("eth_blockNumber", []);
  if (latestData.error) throw new Error("Failed to get latest block number");
  let hi = parseInt(latestData.result, 16);
  let lo = 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const ts = await getBlockTimestamp(mid);
    if (ts <= timestamp) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}

async function getEthBalance(address: string, blockNumber: number): Promise<string> {
  const blockHex = "0x" + blockNumber.toString(16);
  const data = await ethRpc("eth_getBalance", [address, blockHex]);
  if (data.error) throw new Error(data.error.message || "Failed to get ETH balance");
  const wei = BigInt(data.result);
  return (Number(wei) / 1e18).toFixed(6);
}

interface TokenHolding {
  symbol: string;
  name: string;
  balance: string;
  contractAddress: string;
  decimals: number;
}

async function getEthTokenBreakdown(
  address: string,
  blockNumber: number
): Promise<TokenHolding[]> {
  const allTransfers: Array<{
    contractAddress: string;
    tokenSymbol: string;
    tokenName: string;
    tokenDecimal: string;
    to: string;
    from: string;
    value: string;
  }> = [];

  let page = 1;
  const pageSize = 10000;
  const addrLower = address.toLowerCase();

  while (page <= 10) {
    const qs = etherscanParams({
      module: "account",
      action: "tokentx",
      address,
      startblock: "0",
      endblock: String(blockNumber),
      page: String(page),
      offset: String(pageSize),
      sort: "asc",
    });
    const res = await fetch(`${ETHERSCAN_API}?${qs}`);
    const data = await res.json();

    if (data.status !== "1" || !Array.isArray(data.result)) break;
    allTransfers.push(...data.result);
    if (data.result.length < pageSize) break;
    page++;
  }

  if (allTransfers.length === 0) return [];

  const tokenMap = new Map<
    string,
    { symbol: string; name: string; decimals: number; net: bigint }
  >();

  for (const tx of allTransfers) {
    const contract = tx.contractAddress.toLowerCase();
    if (!tokenMap.has(contract)) {
      tokenMap.set(contract, {
        symbol: tx.tokenSymbol,
        name: tx.tokenName,
        decimals: parseInt(tx.tokenDecimal, 10) || 18,
        net: 0n,
      });
    }
    const entry = tokenMap.get(contract)!;
    const val = BigInt(tx.value);
    if (tx.to.toLowerCase() === addrLower) entry.net += val;
    if (tx.from.toLowerCase() === addrLower) entry.net -= val;
  }

  const holdings: TokenHolding[] = [];
  for (const [contract, data] of tokenMap) {
    if (data.net <= 0n) continue;
    const divisor = 10 ** data.decimals;
    const balance = Number(data.net) / divisor;
    if (balance < 0.000001) continue;
    holdings.push({
      symbol: data.symbol,
      name: data.name,
      balance: balance < 1 ? balance.toPrecision(4) : balance.toFixed(4),
      contractAddress: contract,
      decimals: data.decimals,
    });
  }

  holdings.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return holdings;
}

// ── SOL helpers ─────────────────────────────────────────────────────────

async function solanaRpc(method: string, params: unknown[]) {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

// Reconstruct SOL balance at a target date by walking back from current balance
// using transaction history. This gives an accurate historical native balance.
async function getSolHistoricalBalance(
  address: string,
  dateStr: string
): Promise<{ balance: string; slot?: number; isHistorical: boolean }> {
  // Get current balance first
  const currentData = await solanaRpc("getBalance", [address]);
  if (currentData.error) {
    throw new Error(currentData.error.message || "Failed to get SOL balance");
  }
  const currentLamports: number = currentData.result?.value ?? 0;
  const currentSlot: number = currentData.result?.context?.slot;

  const targetDate = new Date(dateStr + "T23:59:59Z");
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // If today or yesterday, just return current balance
  if (diffDays <= 1) {
    return {
      balance: (currentLamports / 1e9).toFixed(6),
      slot: currentSlot,
      isHistorical: true,
    };
  }

  // Walk through transaction signatures to reconstruct historical balance.
  // We sum up all SOL changes (in/out) that happened AFTER the target date
  // and subtract them from the current balance to get the balance at that date.
  const targetTimestamp = Math.floor(targetDate.getTime() / 1000);
  let netChangeAfterDate = 0; // in lamports
  let beforeSig: string | undefined;
  let reachedTarget = false;
  let pagesScanned = 0;
  const maxPages = 20; // safety limit

  while (!reachedTarget && pagesScanned < maxPages) {
    pagesScanned++;
    const sigParams: Record<string, unknown> = { limit: 1000 };
    if (beforeSig) sigParams.before = beforeSig;

    const sigData = await solanaRpc("getSignaturesForAddress", [
      address,
      sigParams,
    ]);

    if (sigData.error || !sigData.result || sigData.result.length === 0) break;

    for (const sig of sigData.result) {
      // If this transaction is before our target date, we're done
      if (sig.blockTime && sig.blockTime <= targetTimestamp) {
        reachedTarget = true;
        break;
      }

      // Skip failed transactions
      if (sig.err !== null) continue;

      // Fetch the actual transaction to see SOL balance changes
      try {
        const txData = await solanaRpc("getTransaction", [
          sig.signature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
        ]);

        if (!txData.result?.meta) continue;

        const meta = txData.result.meta;
        const accountKeys =
          txData.result.transaction?.message?.accountKeys ?? [];

        // Find this wallet's index in the account keys
        let walletIndex = -1;
        for (let i = 0; i < accountKeys.length; i++) {
          const key =
            typeof accountKeys[i] === "string"
              ? accountKeys[i]
              : accountKeys[i]?.pubkey;
          if (key === address) {
            walletIndex = i;
            break;
          }
        }

        if (walletIndex === -1) continue;

        const preBal = meta.preBalances?.[walletIndex] ?? 0;
        const postBal = meta.postBalances?.[walletIndex] ?? 0;
        const diff = postBal - preBal; // positive = received, negative = sent
        netChangeAfterDate += diff;
      } catch {
        // If we can't fetch a transaction, skip it
        continue;
      }
    }

    // Set cursor for next page
    const lastSig = sigData.result[sigData.result.length - 1];
    beforeSig = lastSig.signature;

    // If the oldest tx on this page is already before our date, done
    if (lastSig.blockTime && lastSig.blockTime <= targetTimestamp) {
      reachedTarget = true;
    }
  }

  // Historical balance = current balance - net change that happened after the target date
  const historicalLamports = currentLamports - netChangeAfterDate;
  const historicalSol = Math.max(0, historicalLamports) / 1e9;

  return {
    balance: historicalSol.toFixed(6),
    slot: currentSlot,
    isHistorical: reachedTarget,
  };
}

// Known SPL token metadata (top tokens)
const SPL_TOKEN_META: Record<string, { symbol: string; name: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "Tether USD", decimals: 6 },
  So11111111111111111111111111111111111111112: { symbol: "WSOL", name: "Wrapped SOL", decimals: 9 },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "mSOL", name: "Marinade SOL", decimals: 9 },
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": { symbol: "stSOL", name: "Lido Staked SOL", decimals: 9 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", name: "Bonk", decimals: 5 },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", name: "Jupiter", decimals: 6 },
  rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: { symbol: "RNDR", name: "Render Token", decimals: 8 },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: "PYTH", name: "Pyth Network", decimals: 6 },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "RAY", name: "Raydium", decimals: 6 },
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: { symbol: "ORCA", name: "Orca", decimals: 6 },
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": { symbol: "ETH", name: "Ether (Wormhole)", decimals: 8 },
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: { symbol: "JTO", name: "Jito", decimals: 9 },
  WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk: { symbol: "WEN", name: "WEN", decimals: 5 },
};

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

async function getSolTokenBreakdown(address: string): Promise<TokenHolding[]> {
  const data = await solanaRpc("getTokenAccountsByOwner", [
    address,
    { programId: TOKEN_PROGRAM_ID },
    { encoding: "jsonParsed" },
  ]);

  if (data.error || !data.result?.value) return [];

  const holdings: TokenHolding[] = [];

  for (const account of data.result.value) {
    const parsed = account.account?.data?.parsed?.info;
    if (!parsed) continue;

    const mint: string = parsed.mint;
    const amount = parsed.tokenAmount;
    if (!amount || Number(amount.uiAmount) === 0) continue;

    const meta = SPL_TOKEN_META[mint];
    const uiAmount = Number(amount.uiAmount);

    holdings.push({
      symbol: meta?.symbol || mint.slice(0, 6) + "...",
      name: meta?.name || "Unknown Token",
      balance: uiAmount < 1 ? uiAmount.toPrecision(4) : uiAmount.toFixed(4),
      contractAddress: mint,
      decimals: amount.decimals,
    });
  }

  holdings.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return holdings;
}

// ── Main handler ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { address, chain, date } = await req.json();

    if (!address || !chain || !date) {
      return NextResponse.json(
        { error: "Missing required fields: address, chain, date" },
        { status: 400 }
      );
    }

    if (chain === "ETH") {
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return NextResponse.json(
          { error: "Invalid Ethereum address format" },
          { status: 400 }
        );
      }

      const targetDate = new Date(date + "T23:59:59Z");
      const timestamp = Math.floor(targetDate.getTime() / 1000);

      const blockNumber = await getEthBlockByTimestamp(timestamp);

      const [balance, tokens, priceUsd] = await Promise.all([
        getEthBalance(address, blockNumber),
        getEthTokenBreakdown(address, blockNumber).catch(() => [] as TokenHolding[]),
        getHistoricalPrice("ethereum", date),
      ]);

      const balanceNum = parseFloat(balance);
      const usdValue = priceUsd ? (balanceNum * priceUsd).toFixed(2) : null;

      return NextResponse.json({
        address,
        chain: "ETH",
        date,
        balance,
        symbol: "ETH",
        blockNumber,
        tokens,
        priceUsd,
        usdValue,
        isHistorical: true,
      });
    }

    if (chain === "SOL") {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        return NextResponse.json(
          { error: "Invalid Solana address format" },
          { status: 400 }
        );
      }

      const [{ balance, slot, isHistorical }, tokens, priceUsd] =
        await Promise.all([
          getSolHistoricalBalance(address, date),
          getSolTokenBreakdown(address),
          getHistoricalPrice("solana", date),
        ]);

      const balanceNum = parseFloat(balance);
      const usdValue = priceUsd ? (balanceNum * priceUsd).toFixed(2) : null;

      return NextResponse.json({
        address,
        chain: "SOL",
        date,
        balance,
        symbol: "SOL",
        slot,
        tokens,
        priceUsd,
        usdValue,
        isHistorical,
      });
    }

    return NextResponse.json(
      { error: "Unsupported chain. Use ETH or SOL." },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
