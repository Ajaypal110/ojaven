import { NextRequest, NextResponse } from "next/server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let email: unknown;

  try {
    const body = await request.json();
    email = body?.email;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  // TODO: Swap this out for real persistence before launch.
  // Options: Vercel KV (`@vercel/kv`), Supabase, or an email provider API (e.g. ConvertKit).
  // For now, submissions are just logged so the endpoint is functional without extra infra.
  console.log("[waitlist] new signup:", email.toLowerCase().trim());

  return NextResponse.json({ ok: true });
}
