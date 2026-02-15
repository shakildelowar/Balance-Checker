import { NextRequest, NextResponse } from "next/server";

const ETHERSCAN_API = "https://api.etherscan.io/api";
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || "";
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

function etherscanParams(extra: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (ETHERSCAN_KEY) params.set("apikey", ETHERSCAN_KEY);
  return params.toString();
}

// ── ETH helpers ─────────────────────────────────────────────────────────

async function getEthBlockByTimestamp(timestamp: number): Promise<number> {
  const qs = etherscanParams({
    module: "block",
    action: "getblocknobytime",
    timestamp: String(timestamp),
    closest: "before",
  });
  const res = await fetch(`${ETHERSCAN_API}?${qs}`);
  const data = await res.json();
  if (data.status !== "1") {
    throw new Error(data.message || "Failed to get block number for date");
  }
  return parseInt(data.result, 10);
}

async function getEthBalance(address: string, blockNumber: number): Promise<string> {
  const blockHex = "0x" + blockNumber.toString(16);
  const rpcUrl = process.env.ETH_RPC_URL || "https://cloudflare-eth.com";
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, blockHex],
      id: 1,
    }),
  });
  const data = await res.json();
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
  // Fetch all ERC-20 transfers to/from this address up to the target block
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

  // Paginate through token transfers (Etherscan max 10k per page)
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

  // Calculate net balance per token
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

  // Convert to array, filter out zero balances
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

  // Sort by symbol for consistent display
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

async function getSolBalance(
  address: string,
  dateStr: string
): Promise<{ balance: string; slot?: number }> {
  const targetDate = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 2) {
    const data = await solanaRpc("getBalance", [address]);
    if (data.error) throw new Error(data.error.message || "Failed to get SOL balance");
    const lamports = data.result?.value ?? 0;
    return { balance: (lamports / 1e9).toFixed(6), slot: data.result?.context?.slot };
  }

  // Estimate historical slot (~2.5 slots/sec = 216k/day)
  const slotData = await solanaRpc("getSlot", [{ commitment: "finalized" }]);
  if (slotData.error) throw new Error("Failed to get current Solana slot");
  const currentSlot: number = slotData.result;
  const estimatedSlot = Math.max(0, currentSlot - diffDays * 216_000);

  try {
    const balData = await solanaRpc("getBalance", [
      address,
      { commitment: "finalized", minContextSlot: estimatedSlot },
    ]);
    if (balData.error) throw new Error("historical query failed");
    const lamports = balData.result?.value ?? 0;
    return {
      balance: (lamports / 1e9).toFixed(6),
      slot: balData.result?.context?.slot ?? estimatedSlot,
    };
  } catch {
    // Fallback to current balance
    const data = await solanaRpc("getBalance", [address]);
    if (data.error) throw new Error(data.error.message || "Failed to get SOL balance");
    const lamports = data.result?.value ?? 0;
    return { balance: (lamports / 1e9).toFixed(6), slot: data.result?.context?.slot };
  }
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

      // Fetch native balance and token breakdown in parallel
      const [balance, tokens] = await Promise.all([
        getEthBalance(address, blockNumber),
        getEthTokenBreakdown(address, blockNumber),
      ]);

      return NextResponse.json({
        address,
        chain: "ETH",
        date,
        balance,
        symbol: "ETH",
        blockNumber,
        tokens,
      });
    }

    if (chain === "SOL") {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        return NextResponse.json(
          { error: "Invalid Solana address format" },
          { status: 400 }
        );
      }

      // Fetch native balance and token breakdown in parallel
      const [{ balance, slot }, tokens] = await Promise.all([
        getSolBalance(address, date),
        getSolTokenBreakdown(address),
      ]);

      return NextResponse.json({
        address,
        chain: "SOL",
        date,
        balance,
        symbol: "SOL",
        slot,
        tokens,
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
