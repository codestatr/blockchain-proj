import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, verifyMessage } from "viem";
import { z } from "zod";
import { consumeWalletNonce, getUserForRequest, linkWallet } from "@/lib/auth";

export const runtime = "nodejs";
const schema = z.object({ address: z.string().refine(isAddress), message: z.string().min(20).max(500), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

export async function POST(request: NextRequest) {
  const user = await getUserForRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to link a wallet." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid wallet verification request." }, { status: 400 });
  const nonce = parsed.data.message.match(/\nNonce: ([a-f0-9]{48})$/)?.[1];
  const expectedMessage = nonce ? `Link this wallet to your Waste System account.\nAccount: ${user.id}\nNonce: ${nonce}` : "";
  if (!nonce || parsed.data.message !== expectedMessage) {
    return NextResponse.json({ error: "Wallet verification expired. Please try again." }, { status: 400 });
  }
  const address = getAddress(parsed.data.address);
  const valid = await verifyMessage({ address, message: parsed.data.message, signature: parsed.data.signature as `0x${string}` }).catch(() => false);
  if (!valid) return NextResponse.json({ error: "The wallet signature could not be verified." }, { status: 401 });
  if (!(await consumeWalletNonce(user.id, nonce))) return NextResponse.json({ error: "Wallet verification expired. Please try again." }, { status: 400 });
  try {
    await linkWallet(user.id, address);
    return NextResponse.json({ walletAddress: address });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not link wallet." }, { status: 409 });
  }
}
