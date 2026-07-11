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

    if (status === "loading") return;

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

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Something went wrong. Please try again.");
        return;
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
      className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:items-center sm:gap-3"
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
          className="w-full border-0 border-b-2 border-white/10 bg-white/[0.03] px-1 py-3 text-base font-normal text-foreground outline-none transition-colors placeholder:text-[#A0A0A0] focus:border-accent disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        disabled={status === "loading"}
        className="whitespace-nowrap rounded-md bg-accent px-7 py-3.5 text-sm font-semibold text-white outline-none transition-colors duration-200 ease-in-out hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-accent-disabled disabled:hover:bg-accent-disabled"
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
