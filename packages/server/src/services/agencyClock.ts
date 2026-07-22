import { eq } from "drizzle-orm";
import { agencySettings, db } from "@ojaven/db";

/**
 * "Today" as a YYYY-MM-DD calendar date in the given IANA timezone. entryDate
 * is a bare calendar date, so future-vs-today must be judged in the agency's
 * zone, not server UTC — otherwise a user ahead of UTC logging their genuine
 * "today" gets rejected as future. `now` is injectable so the boundary is
 * deterministically testable. Invalid/empty tz falls back to UTC.
 */
export function todayInTimezone(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }
}

/** Current reporting month (YYYY-MM) in the given timezone. */
export function currentMonthInTimezone(tz: string, now: Date = new Date()): string {
  return todayInTimezone(tz, now).slice(0, 7);
}

/** The agency's configured timezone (A1 settings), defaulting to UTC. */
export async function getAgencyTimezone(agencyId: string): Promise<string> {
  const [row] = await db
    .select({ tz: agencySettings.timezone })
    .from(agencySettings)
    .where(eq(agencySettings.agencyId, agencyId))
    .limit(1);
  return row?.tz || "UTC";
}
