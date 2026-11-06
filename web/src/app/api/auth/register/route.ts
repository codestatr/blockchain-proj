import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { registerUser, startSession } from "@/lib/auth";

export const runtime = "nodejs";
const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128)
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your name, a valid email, and a password of at least 12 characters." }, { status: 400 });
  try {
    const user = await registerUser(parsed.data.name, parsed.data.email, parsed.data.password);
    await startSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Registration failed", error);
    return NextResponse.json({ error: "Could not create your account." }, { status: 500 });
  }
}
