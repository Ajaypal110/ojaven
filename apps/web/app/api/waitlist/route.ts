import { NextRequest, NextResponse } from "next/server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

// In-memory store — fine for MVP scale. Resets on cold start / per instance,
// so it's a soft limit rather than a globally consistent one.
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count += 1;
  return false;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    // Google Apps Script Web App webhook — see README "Waitlist Setup" for
    // how to create the sheet + script and get these two values.
    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    const secret = process.env.GOOGLE_SHEETS_SECRET;

    if (!webhookUrl || !secret) {
      console.error("Missing Google Sheets env vars");
      // Still return success to user - don't leak infra failure
      return NextResponse.json({ success: true });
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        secret,
        source: "landing_page",
        userAgent: request.headers.get("user-agent") || "",
      }),
    });

    if (!response.ok) {
      console.error("Google Sheets webhook failed:", response.status);
      // Still return success to user
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Waitlist error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
