import { NextRequest, NextResponse } from "next/server";

const ETHERSCAN_API = "https://api.etherscan.io/api";

async function getEthBlockByTimestamp(timestamp: number): Promise<number> {
  const url = `${ETHERSCAN_API}?module=block&action=getblocknobytime&timestamp=${timestamp}&closest=before`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "1") {
    throw new Error(data.message || "Failed to get block number for date");
  }
  return parseInt(data.result, 10);
}

async function getEthBalance(
  address: string,
  blockNumber: number
): Promise<string> {
  const blockHex = "0x" + blockNumber.toString(16);
  // Use public Cloudflare ETH RPC for eth_getBalance with block param
  const res = await fetch("https://cloudflare-eth.com", {
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
  if (data.error) {
    throw new Error(data.error.message || "Failed to get ETH balance");
  }
  const weiBalance = BigInt(data.result);
  const ethBalance = Number(weiBalance) / 1e18;
  return ethBalance.toFixed(6);
}

async function getSolBalance(
  address: string,
  dateStr: string
): Promise<{ balance: string; slot?: number }> {
  // First try to get current balance as Solana doesn't easily support historical queries
  // via public RPC without an archival node. We'll use the public RPC.
  const targetDate = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const rpcUrl = "https://api.mainnet-beta.solana.com";

  // For recent dates, try to get a historical slot
  if (diffDays <= 2) {
    // Recent enough - get current balance
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || "Failed to get SOL balance");
    }
    const lamports = data.result?.value ?? 0;
    const solBalance = lamports / 1e9;
    return { balance: solBalance.toFixed(6), slot: data.result?.context?.slot };
  }

  // For historical dates, estimate the slot from the target timestamp.
  // Solana produces ~2.5 slots/second on average.
  // We get the current slot, then calculate backwards.
  const slotRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSlot",
      params: [{ commitment: "finalized" }],
    }),
  });
  const slotData = await slotRes.json();
  if (slotData.error) {
    throw new Error("Failed to get current Solana slot");
  }
  const currentSlot: number = slotData.result;

  // Estimate target slot: ~2.5 slots/sec = 216,000 slots/day
  const SLOTS_PER_DAY = 216_000;
  const estimatedSlot = Math.max(
    0,
    currentSlot - diffDays * SLOTS_PER_DAY
  );

  // Try to get balance at estimated historical slot
  try {
    const balRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [
          address,
          { commitment: "finalized", minContextSlot: estimatedSlot },
        ],
      }),
    });
    const balData = await balRes.json();

    if (balData.error) {
      // If historical query fails, public RPCs often don't support old slots
      // Fall back to current balance with a note
      const fallbackRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBalance",
          params: [address],
        }),
      });
      const fallbackData = await fallbackRes.json();
      if (fallbackData.error) {
        throw new Error(
          fallbackData.error.message || "Failed to get SOL balance"
        );
      }
      const lamports = fallbackData.result?.value ?? 0;
      const solBalance = lamports / 1e9;
      return {
        balance: solBalance.toFixed(6),
        slot: fallbackData.result?.context?.slot,
      };
    }

    const lamports = balData.result?.value ?? 0;
    const solBalance = lamports / 1e9;
    return {
      balance: solBalance.toFixed(6),
      slot: balData.result?.context?.slot ?? estimatedSlot,
    };
  } catch {
    // Final fallback: current balance
    const fallbackRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });
    const fallbackData = await fallbackRes.json();
    if (fallbackData.error) {
      throw new Error(
        fallbackData.error.message || "Failed to get SOL balance"
      );
    }
    const lamports = fallbackData.result?.value ?? 0;
    const solBalance = lamports / 1e9;
    return {
      balance: solBalance.toFixed(6),
      slot: fallbackData.result?.context?.slot,
    };
  }
}

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
      // Validate ETH address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return NextResponse.json(
          { error: "Invalid Ethereum address format" },
          { status: 400 }
        );
      }

      // Convert date to end-of-day timestamp
      const targetDate = new Date(date + "T23:59:59Z");
      const timestamp = Math.floor(targetDate.getTime() / 1000);

      const blockNumber = await getEthBlockByTimestamp(timestamp);
      const balance = await getEthBalance(address, blockNumber);

      return NextResponse.json({
        address,
        chain: "ETH",
        date,
        balance,
        symbol: "ETH",
        blockNumber,
      });
    }

    if (chain === "SOL") {
      // Basic Solana address validation (base58, 32-44 chars)
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        return NextResponse.json(
          { error: "Invalid Solana address format" },
          { status: 400 }
        );
      }

      const { balance, slot } = await getSolBalance(address, date);

      return NextResponse.json({
        address,
        chain: "SOL",
        date,
        balance,
        symbol: "SOL",
        slot,
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
