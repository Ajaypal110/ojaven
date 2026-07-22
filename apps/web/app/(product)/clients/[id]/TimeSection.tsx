"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@ojaven/server";
import { trpc } from "@/lib/trpc/client";

type Outputs = inferRouterOutputs<AppRouter>;
type TimeEntry = Outputs["time"]["listByClient"]["entries"][number];
type Member = Outputs["team"]["list"]["members"][number];

const warn = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.85rem" } as const;
const card = { border: "1px solid #333", borderRadius: 6, padding: "0.75rem" } as const;

function nowMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function memberName(m: Member | undefined): string {
  if (!m) return "Unknown";
  const full = `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim();
  return full || m.email;
}

export function TimeSection({ clientId }: { clientId: string }) {
  const [month, setMonth] = useState(nowMonth());
  const utils = trpc.useUtils();

  const team = trpc.team.list.useQuery();
  const rollup = trpc.time.monthlyRollup.useQuery({ clientId, month });
  const list = trpc.time.listByClient.useQuery({ clientId, month });

  const callerRole = team.data?.callerRole;
  const callerUserId = team.data?.members.find((m) => m.id === team.data?.callerMemberId)?.userId;
  const canSetRetainer = callerRole === "owner" || callerRole === "admin";
  const members = team.data?.members ?? [];
  const canModify = (e: TimeEntry) =>
    e.userId === callerUserId || callerRole === "owner" || callerRole === "admin";

  const refresh = () => utils.time.invalidate();

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Time</h2>
        <label style={{ ...muted, display: "flex", alignItems: "center", gap: "0.4rem" }}>
          Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || nowMonth())} />
        </label>
      </div>

      {rollup.data && <RollupSummary rollup={rollup.data} />}

      {canSetRetainer && <RetainerControl clientId={clientId} onChanged={refresh} />}

      <LogEntryForm clientId={clientId} onLogged={refresh} />

      {list.isLoading && <p style={muted}>Loading…</p>}
      {list.data?.entries.length === 0 && <p style={muted}>No time logged this month.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {(list.data?.entries ?? []).map((e) => (
          <EntryRow
            key={e.id}
            entry={e}
            authorName={memberName(members.find((m) => m.userId === e.userId))}
            canModify={canModify(e)}
            onChanged={refresh}
          />
        ))}
      </ul>
    </section>
  );
}

function RollupSummary({ rollup }: { rollup: Outputs["time"]["monthlyRollup"] }) {
  const {
    retainerHours,
    billableHours,
    nonBillableHours,
    totalHours,
    overServiceHours,
    overServicePct,
    isOverService,
  } = rollup;

  return (
    <div
      style={{
        ...card,
        marginTop: "1rem",
        borderColor: isOverService ? "#D97706" : "#333",
      }}
    >
      {retainerHours == null ? (
        <p style={{ ...muted, margin: 0 }}>No retainer set for this month.</p>
      ) : (
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "baseline" }}>
          <Stat label="Retainer" value={`${retainerHours}h`} />
          <Stat label="Billable" value={`${billableHours}h`} />
          <Stat label="Used" value={`${overServicePct ?? 0}%`} emphasis={isOverService} />
          {isOverService ? (
            <strong style={{ color: "#D97706" }}>
              Over budget by {overServiceHours}h
            </strong>
          ) : (
            <span style={{ color: "#3FB950" }}>Within retainer</span>
          )}
        </div>
      )}
      <div style={{ ...muted, marginTop: "0.5rem" }}>
        {billableHours}h billable · {nonBillableHours}h non-billable · {totalHours}h total
      </div>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div style={muted}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 600, color: emphasis ? "#D97706" : undefined }}>
        {value}
      </div>
    </div>
  );
}

/** Owner/admin only — set/change the retainer effective from a month. */
function RetainerControl({ clientId, onChanged }: { clientId: string; onChanged: () => void }) {
  const utils = trpc.useUtils();
  const current = trpc.retainers.getCurrent.useQuery({ clientId });
  const [hours, setHours] = useState("");
  const [fromMonth, setFromMonth] = useState(nowMonth());

  const set = trpc.retainers.set.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.retainers.invalidate(), Promise.resolve(onChanged())]);
      setHours("");
    },
  });

  return (
    <div style={{ ...card, marginTop: "1rem" }}>
      <p style={{ ...muted, marginTop: 0 }}>
        Retainer (owner/admin) ·{" "}
        {current.data
          ? `currently ${Number(current.data.hoursPerMonth)}h/mo since ${current.data.effectiveFrom}`
          : "none set"}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="number"
          min="0"
          step="0.5"
          placeholder="hours/mo"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          style={{ width: "8rem" }}
        />
        <label style={{ ...muted, display: "flex", alignItems: "center", gap: "0.3rem" }}>
          from
          <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={set.isPending || hours.trim() === ""}
          onClick={() =>
            set.mutate({
              clientId,
              hoursPerMonth: Number(hours),
              effectiveFrom: `${fromMonth}-01`,
            })
          }
        >
          {set.isPending ? "Saving…" : "Set retainer"}
        </button>
      </div>
      {set.error && <p style={warn}>{set.error.message}</p>}
    </div>
  );
}

function LogEntryForm({ clientId, onLogged }: { clientId: string; onLogged: () => void }) {
  const [hours, setHours] = useState("");
  const [entryDate, setEntryDate] = useState(today());
  const [isBillable, setIsBillable] = useState(true);
  const [description, setDescription] = useState("");

  const log = trpc.time.logEntry.useMutation({
    onSuccess: () => {
      onLogged();
      setHours("");
      setDescription("");
    },
  });

  return (
    <div style={{ ...card, marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
      <input type="number" min="0" step="0.25" placeholder="hours" value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: "6rem" }} />
      <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
      <label style={{ ...muted, display: "flex", alignItems: "center", gap: "0.3rem" }}>
        <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
        Billable
      </label>
      <input placeholder="description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} style={{ flex: 1, minWidth: "8rem" }} />
      <button
        type="button"
        disabled={log.isPending || hours.trim() === ""}
        onClick={() =>
          log.mutate({
            clientId,
            hours: Number(hours),
            entryDate,
            isBillable,
            description: description || undefined,
          })
        }
      >
        {log.isPending ? "Logging…" : "Log time"}
      </button>
      {log.error && <span style={warn}>{log.error.message}</span>}
    </div>
  );
}

function EntryRow({
  entry,
  authorName,
  canModify,
  onChanged,
}: {
  entry: TimeEntry;
  authorName: string;
  canModify: boolean;
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hours, setHours] = useState(String(Number(entry.hours)));
  const [entryDate, setEntryDate] = useState(entry.entryDate);
  const [isBillable, setIsBillable] = useState(entry.isBillable);
  const [description, setDescription] = useState(entry.description ?? "");

  const done = () => {
    onChanged();
    setEditing(false);
    setConfirmDelete(false);
  };
  const update = trpc.time.updateEntry.useMutation({ onSuccess: done });
  const del = trpc.time.deleteEntry.useMutation({ onSuccess: done });

  if (editing) {
    return (
      <li style={card}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input type="number" min="0" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: "6rem" }} />
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          <label style={{ ...muted, display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
            Billable
          </label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ flex: 1, minWidth: "8rem" }} />
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: entry.id, hours: Number(hours), entryDate, isBillable, description })}
          >
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div>
        {update.error && <p style={warn}>{update.error.message}</p>}
      </li>
    );
  }

  return (
    <li style={{ ...card, borderColor: entry.isOverService ? "#D97706" : "#333" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline" }}>
        <span>
          <strong>{Number(entry.hours)}h</strong> · {entry.entryDate}
          {!entry.isBillable && <span style={muted}> · non-billable</span>}
          {entry.isOverService && <strong style={{ color: "#D97706" }}> · over retainer</strong>}
        </span>
        <span style={muted}>{authorName}</span>
      </div>
      {entry.description && <div style={{ marginTop: "0.25rem" }}>{entry.description}</div>}

      {canModify && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button type="button" onClick={() => setEditing(true)}>Edit</button>
          {confirmDelete ? (
            <>
              <button type="button" disabled={del.isPending} onClick={() => del.mutate({ id: entry.id })}>
                {del.isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)}>Delete</button>
          )}
        </div>
      )}
      {del.error && <p style={warn}>{del.error.message}</p>}
    </li>
  );
}
