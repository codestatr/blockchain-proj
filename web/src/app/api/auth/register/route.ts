import { randomUUID } from "node:crypto";
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
  const referenceId = randomUUID().slice(0, 8).toUpperCase();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your name, a valid email, and a password of at least 12 characters." }, { status: 400 });
  let stage = "create_user";
  try {
    const user = await registerUser(parsed.data.name, parsed.data.email, parsed.data.password);
    stage = "start_session";
    await startSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) return NextResponse.json({ error: error.message }, { status: 409 });
    const detail = error instanceof Error ? error.message : String(error);
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code).slice(0, 40)
      : undefined;
    const safeDetail = detail
      .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[database URL redacted]")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email redacted]")
      .replace(/\b(password|secret|token|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .slice(0, 500);
    console.error(JSON.stringify({
      event: "auth.register.failed",
      referenceId,
      stage,
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: code,
      errorMessage: safeDetail
    }));
    return NextResponse.json({ error: "Could not create your account.", referenceId }, { status: 500 });
  }
}
