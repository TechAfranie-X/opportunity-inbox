import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { computeValidationMetrics } from "@/lib/recruiting/metrics";
import { loadValidationRows } from "@/lib/recruiting/store";

export const metadata = { title: "Validation metrics" };

/** Operator-only. Testers are anonymised and no email content is shown. */
export default async function ValidationPage() {
  const session = await auth();
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = session?.user?.email?.toLowerCase();
  if (!email || !admins.includes(email) || !isDatabaseConfigured()) notFound();

  const testers = computeValidationMetrics(await loadValidationRows());
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-xl font-semibold">Validation metrics</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Questions: value after connect (events extracted) · trust (correction rate, low is better) · discovery (events extracted vs. what they expected) · repeat use (Today views, return days) · correction behaviour.
      </p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>{["Tester", "Connected", "Scanned", "Events", "Corrected", "Rate", "By field", "Today views", "Active days", "Return days", "Done clicks", "Last seen"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {testers.map((t) => (
              <tr key={t.label} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-2 py-2 font-medium">{t.label}</td>
                <td className="px-2 py-2">{date(t.connectedAt)}</td>
                <td className="px-2 py-2">{t.messagesScanned}</td>
                <td className="px-2 py-2">{t.eventsExtracted}</td>
                <td className="px-2 py-2">{t.eventsCorrected}</td>
                <td className="px-2 py-2">{pct(t.correctionRate)}</td>
                <td className="px-2 py-2 text-xs">{Object.entries(t.correctionsByField).map(([f, n]) => `${f}:${n}`).join(" ") || "—"}</td>
                <td className="px-2 py-2">{t.todayViews}</td>
                <td className="px-2 py-2">{t.activeDays}</td>
                <td className="px-2 py-2">{t.returnDays}</td>
                <td className="px-2 py-2">{t.actionsDismissed}</td>
                <td className="px-2 py-2">{date(t.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {testers.length === 0 ? <p className="mt-4 text-sm text-zinc-500">No testers yet.</p> : null}
      </div>
    </main>
  );
}
