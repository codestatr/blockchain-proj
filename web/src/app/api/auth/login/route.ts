import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser, startSession } from "@/lib/auth";

export const runtime = "nodejs";
const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  const user = await authenticateUser(parsed.data.email, parsed.data.password);
  if (!user) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  await startSession(user.id);
  return NextResponse.json({ user });
}
