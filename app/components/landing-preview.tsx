import Link from "next/link";
import { EntityMark } from "@/app/components/entity-mark";

/**
 * The transformation, shown as the product really is, in one frame: recruiting mail buried in a Gmail inbox, the same mail as opportunities on
 * the Pipeline, and what needs you today. Built from the product's own styles (panels, cards, marks, rows) so the page promises what the
 * app delivers. Static on purpose; the whole frame opens the live demo.
 */
const INBOX: Array<[string, string, boolean]> = [
  ["Priya Nair", "Quick question about your background", true],
  ["The Weekly Dev", "This week: 10 tips for your next interview", false],
  ["Greenhouse", "Thank you for applying to Plaid", true],
  ["Chase", "Your statement is ready", false],
  ["HackerRank", "Cloudflare: Online Assessment", true],
  ["LinkedIn", "Your job alert: Software Engineer Intern", false],
  ["Maya Chen", "Next steps: schedule your interview", true],
  ["Figma Recruiting", "Your Figma interview is confirmed", true],
];

const BOARD: Array<[string, Array<[string, string, string]>]> = [
  ["Assessment", [["Cloudflare", "Systems Engineer Intern", "Due Fri 11:59 PM"], ["Plaid", "Backend Engineer Intern", "Applied 3 days ago"], ["Okta", "Security Engineer Intern", "Due Mon"]]],
  ["Interview", [["Figma", "Software Engineer Intern", "Wed 2:00 PM"], ["Lyft", "Product Management Intern", "Thu 2:00 PM"], ["Datadog", "Backend Engineer Intern", "Reply to Priya"]]],
];

export function LandingPreview() {
  return (
    <Link href="/demo" aria-label="Open the live demo with sample data" className="group block rounded-[var(--r-lg)]">
      <div className="preview-frame" aria-hidden>
        <div className="grid lg:grid-cols-[14.5rem_minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* 1. the mess */}
          <div className="inbox-pane border-b border-line p-4 lg:border-b-0 lg:border-r">
            <p className="t-meta px-1 pb-3 font-medium text-ink-2">Your Gmail</p>
            <ul className="space-y-0.5">
              {INBOX.map(([from, subject, signal], i) => (
                <li key={subject} className={`rounded-md px-2 py-1.5 ${i > 4 ? "max-lg:hidden" : ""} ${signal ? "" : "opacity-55"}`}>
                  <p className="truncate text-[0.75rem] font-medium">{from}</p>
                  <p className="truncate text-[0.75rem] text-ink-2">{subject}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* 2. the structure */}
          <div className="border-b border-line p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <p className="t-meta pb-3 font-medium text-ink-2">Pipeline</p>
            <div className="grid grid-cols-2 gap-3">
              {BOARD.map(([stage, cards]) => (
                <div key={stage} className="min-w-0">
                  <p className="px-0.5 pb-1.5 text-[0.75rem] font-semibold">
                    {stage} <span className="ml-0.5 font-normal text-ink-3">{cards.length}</span>
                  </p>
                  <div className="space-y-2">
                    {cards.map(([c, r, n]) => (
                      <div key={c} className="panel p-2.5">
                        <div className="flex items-center gap-2">
                          <EntityMark name={c} state="known" size="sm" />
                          <p className="truncate text-[0.75rem] font-medium">{c}</p>
                        </div>
                        <p className="mt-1.5 truncate text-[0.6875rem] text-ink-2">{r}</p>
                        <p className="mt-1 truncate text-[0.6875rem] text-ink-3">{n}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3. the plan */}
          <div className="p-4 sm:p-5">
            <p className="t-meta pb-3 font-medium text-ink-2">Today</p>
            <p className="font-[family-name:var(--font-serif)] text-[1.375rem] font-medium leading-[1.1] tracking-[-0.02em]">
              Good morning, Sam.
              <span className="block text-ink-3">3 things need you today.</span>
            </p>
            <div className="panel mt-4 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <EntityMark name="Datadog" state="known" size="sm" />
                  <p className="truncate text-[0.8125rem] font-medium">Datadog</p>
                </div>
                <p className="shrink-0 text-[0.75rem] font-medium text-signal">Now</p>
              </div>
              <p className="mt-2.5 font-[family-name:var(--font-serif)] text-[1.0625rem] font-medium leading-tight">Reply to book your interview</p>
              <span className="btn-primary mt-3 !h-8 !px-3 !text-[0.8125rem]">Open email</span>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              {[["Cloudflare", "Assessment due Fri"], ["Figma", "Interview Wed 2:00 PM"]].map(([c, t]) => (
                <div key={c} className="panel p-2.5">
                  <div className="flex items-center gap-2">
                    <EntityMark name={c} state="known" size="sm" />
                    <p className="truncate text-[0.75rem] font-medium">{c}</p>
                  </div>
                  <p className="mt-1.5 truncate text-[0.6875rem] text-ink-2">{t}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[0.75rem] text-ink-3">18 waiting on replies</p>
          </div>
        </div>
      </div>
    </Link>
  );
}
