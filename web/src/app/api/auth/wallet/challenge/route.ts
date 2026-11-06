import { NextRequest, NextResponse } from "next/server";
import { getUserForRequest, issueWalletNonce } from "@/lib/auth";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const user = await getUserForRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to link a wallet." }, { status: 401 });
  const { nonce, expires } = await issueWalletNonce(user.id);
  const message = `Link this wallet to your Waste System account.\nAccount: ${user.id}\nNonce: ${nonce}`;
  return NextResponse.json({ message, expires });
}
