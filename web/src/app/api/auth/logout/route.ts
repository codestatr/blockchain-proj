import { NextRequest, NextResponse } from "next/server";
import { endSession } from "@/lib/auth";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  await endSession(request);
  return NextResponse.json({ success: true });
}
