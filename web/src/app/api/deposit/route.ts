import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi, isAddress, getAddress, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { baseSepolia, hardhatLocal } from "@/lib/chains";
import { getUserForRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  wasteType: z.enum(["Plastic", "Glass", "Metal"]),
  weightInGrams: z.number().int().min(1).max(100_000),
  binId: z.string().trim().min(1).max(40),
  chainId: z.number().int().refine((id) => id === 31337 || id === 84532, "Unsupported network")
});
const abi = parseAbi(["function recordDeposit(address citizen,string wasteType,uint256 weightInGrams) returns (uint256 depositId)", "event DepositRecorded(uint256 indexed depositId,address indexed citizen,string wasteType,uint256 weightInGrams,uint256 reward)"]);

export async function POST(request: NextRequest) {
  try {
    const user = await getUserForRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in to record a deposit." }, { status: 401 });
    if (!user.walletAddress) return NextResponse.json({ error: "Link and verify a wallet before recording deposits." }, { status: 403 });
    const body = schema.safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || "Invalid payload" }, { status: 400 });
    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) return NextResponse.json({ error: "Deposit service is not configured." }, { status: 503 });

    const chainId = body.data.chainId;
    const defaultChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
    const contractAddress = chainId === 84532
      ? (process.env.NEXT_PUBLIC_BASE_SEPOLIA_CONTRACT_ADDRESS || (defaultChainId === chainId ? process.env.NEXT_PUBLIC_CONTRACT_ADDRESS : undefined))
      : chainId === 31337
        ? (process.env.NEXT_PUBLIC_LOCAL_CONTRACT_ADDRESS || (defaultChainId === chainId ? process.env.NEXT_PUBLIC_CONTRACT_ADDRESS : undefined))
        : undefined;
    if (!contractAddress || !isAddress(contractAddress)) return NextResponse.json({ error: "Contract address is not configured for this network." }, { status: 503 });
    const chain = chainId === 84532 ? baseSepolia : chainId === 31337 ? hardhatLocal : null;
    if (!chain) return NextResponse.json({ error: "Unsupported server chain configuration." }, { status: 500 });
    const rpcUrl = chainId === 84532 ? (process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org") : (process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545");
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    // A bin ID is included for audit context. The current contract stores the material and weight only.
    console.info("Deposit request", { citizen: user.walletAddress, binId: body.data.binId, wasteType: body.data.wasteType, weightInGrams: body.data.weightInGrams });
    const hash = await walletClient.writeContract({ address: getAddress(contractAddress), abi, functionName: "recordDeposit", args: [getAddress(user.walletAddress), body.data.wasteType, BigInt(body.data.weightInGrams)] });
    // Netlify's synchronous function ceiling is 60 seconds; leave room for DB/RPC and response work.
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 55_000 });
    if (receipt.status !== "success") return NextResponse.json({ error: "Deposit transaction reverted.", transactionHash: hash }, { status: 502 });
    // Read depositId from the receipt's first indexed topic; the on-chain call has no return value in its transaction receipt.
    const depositLog = receipt.logs.find((entry) => {
      if (entry.address.toLowerCase() !== contractAddress.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi, data: entry.data, topics: entry.topics });
        return decoded.eventName === "DepositRecorded";
      } catch { return false; }
    });
    const decodedDeposit = depositLog ? decodeEventLog({ abi, data: depositLog.data, topics: depositLog.topics }) : null;
    if (!decodedDeposit || decodedDeposit.eventName !== "DepositRecorded") {
      return NextResponse.json({ error: "Transaction confirmed, but the deposit event could not be read.", transactionHash: hash }, { status: 502 });
    }
    const depositId = decodedDeposit.args.depositId.toString();
    return NextResponse.json({ success: true, transactionHash: hash, depositId, chainId }, { status: 201 });
  } catch (error) {
    console.error("Deposit API error", error);
    const message = error instanceof Error ? error.message : "Unexpected deposit error";
    const status = /insufficient funds/i.test(message) ? 402 : /rejected|denied/i.test(message) ? 502 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not record deposit. Check service configuration and try again." : message }, { status });
  }
}
