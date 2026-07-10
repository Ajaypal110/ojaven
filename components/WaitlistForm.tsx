"use client";

import { useState, FormEvent } from "react";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "loading" | "success" | "error";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!EMAIL_REGEX.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setStatus("loading");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        throw new Error("Submission failed");
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="flex h-[52px] items-center justify-center">
        <p className="text-base font-medium text-accent">
          You&apos;re in. We&apos;ll be in touch.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:items-end sm:gap-4"
      noValidate
    >
      <div className="flex-1">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "loading"}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "email-error" : undefined}
          className="w-full border-0 border-b border-white/10 bg-transparent px-1 py-2 text-base text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        disabled={status === "loading"}
        className="whitespace-nowrap border border-white/10 px-5 py-2 text-sm font-medium text-foreground transition-colors hover:border-white/30 disabled:opacity-50"
      >
        {status === "loading" ? "Joining…" : "Join waitlist"}
      </button>
      {error && (
        <p id="email-error" role="alert" className="text-xs text-accent">
          {error}
        </p>
      )}
    </form>
  );
}
