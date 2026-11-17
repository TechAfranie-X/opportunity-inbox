import Link from "next/link";
import { Mark } from "@/app/components/brand";

/**
 * The transformation, shown as the product really is: recruiting email in your inbox on the left, the Today command centre built
 * from it on the right. Built from the product's own styles (same panel, rows, navigation and summary), so what the landing page
 * promises is what the app looks like. Static on purpose; the whole frame opens the live demo.
 */
const INBOX: Array<[string, string, string, boolean]> = [
  ["Priya Nair", "Quick question about your background", "Hi Sam, I'm a recruiter at Datadog. Came across your…", true],
  ["Greenhouse", "Thank you for applying to Plaid", "We received your application for the Backend…", true],
  ["The Weekly Dev", "This week: 10 tips for your next interview", "View in browser. Unsubscribe or manage…", false],
  ["HackerRank", "Cloudflare: Online Assessment", "Please complete the assessment by Friday at 11:59…", true],
  ["Chase", "Your statement is ready", "View your statement.", false],
  ["Maya Chen", "Next steps: schedule your interview", "We'd like to invite you to interview for the…", true],
  ["LinkedIn", "Your job alert: Software Engineer Intern", "New jobs match your search. Manage alerts…", false],
  ["Figma Recruiting", "Your Figma interview is confirmed", "Your interview is confirmed for Wednesday at 2:00…", true],
];

const STAGES: Array<[string, number]> = [["Applied", 12], ["Recruiter", 4], ["Assessment", 7], ["Interview", 8], ["Offer", 4]];

export function LandingPreview() {
  return (
    <Link href="/demo" aria-label="Open the live demo with sample data" className="group block rounded-[var(--r-lg)]">
      <div className="preview-frame" aria-hidden>
        <div className="grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
          {/* before: the inbox */}
          <div className="inbox-pane hidden border-r border-line p-4 lg:block">
            <p className="t-meta px-1 pb-3 font-medium text-ink-2">Your inbox</p>
            <ul className="space-y-0.5">
              {INBOX.map(([from, subject, snippet, signal]) => (
                <li key={subject} className={`rounded-md px-2 py-2 ${signal ? "" : "opacity-55"}`}>
                  <p className="truncate text-[0.75rem] font-medium">{from}</p>
                  <p className="truncate text-[0.75rem]">{subject}</p>
                  <p className={`truncate text-[0.6875rem] ${signal ? "text-ink-2" : "text-ink-3"}`}>{snippet}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* after: Today */}
          <div className="min-w-0">
            <div className="flex items-center justify-between border-b border-line px-5">
              <div className="flex items-center gap-6">
                <span className="flex items-center gap-2 py-3 text-[0.8125rem] font-semibold tracking-tight">
                  <Mark />
                  <span className="max-sm:hidden">Opportunity Inbox</span>
                </span>
                <span className="relative inline-flex h-[2.75rem] items-center text-[0.8125rem] font-medium">
                  Today
                  <i className="absolute inset-x-0 -bottom-px h-[2px] bg-accent" />
                </span>
                <span className="text-[0.8125rem] text-ink-3">Pipeline</span>
              </div>
              <span className="flex items-center gap-1.5 text-[0.75rem] text-ink-2">
                <i className="status-dot" /> 2 to check
              </span>
            </div>

            <div className="grid gap-8 px-5 py-6 sm:px-7 md:grid-cols-[minmax(0,1fr)_11.5rem]">
              <div className="min-w-0">
                <p className="text-[0.75rem] text-ink-3">Monday, November 16</p>
                <p className="mt-2 font-[family-name:var(--font-serif)] text-[1.625rem] font-medium leading-[1.1] tracking-[-0.02em]">
                  Good morning, Sam.
                  <span className="block text-ink-3">3 things need you today.</span>
                </p>
                <div className="panel mt-6">
                  <div className="p-4">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[0.8125rem] font-medium text-ink-2">Datadog</p>
                      <p className="text-[0.75rem] font-medium text-signal">Now</p>
                    </div>
                    <p className="mt-1.5 font-[family-name:var(--font-serif)] text-[1.25rem] font-medium leading-tight tracking-[-0.01em]">Backend Engineer Intern</p>
                    <p className="mt-0.5 text-[0.8125rem] text-ink-2">Reply to book your interview</p>
                    <div className="mt-3 flex items-center gap-4">
                      <span className="btn-primary !h-8 !px-3 !text-[0.8125rem]">Open email</span>
                      <span className="text-[0.8125rem] text-ink-2">View history</span>
                    </div>
                  </div>
                  <ul className="list border-t border-line px-4">
                    {[["Cloudflare assessment", "Systems Engineer Intern", "Fri"], ["Figma interview", "Software Engineer Intern", "Wed 2:00 PM"]].map(([t, r, w]) => (
                      <li key={t}>
                        <div className="flex items-baseline justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-[0.8125rem] font-medium">{t}</p>
                            <p className="truncate text-[0.75rem] text-ink-2">{r}</p>
                          </div>
                          <p className="shrink-0 text-[0.75rem] text-ink-3">{w}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="mt-7 text-[0.8125rem] font-semibold">
                  Coming up <span className="ml-1 font-normal text-ink-3">4</span>
                </p>
                <ul className="list mt-1">
                  {[["Thu", "Interview with Lyft", "2:00 PM"], ["Fri", "Databricks assessment", "11:59 PM"], ["Mon", "Interview with Scale AI", "2:00 PM"]].map(([d, t, w]) => (
                    <li key={t}>
                      <div className="flex items-baseline gap-4 py-2.5">
                        <span className="w-9 shrink-0 text-[0.75rem] text-ink-3">{d}</span>
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{t}</span>
                        <span className="shrink-0 text-[0.75rem] text-ink-3">{w}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[0.8125rem] text-ink-3">Waiting on replies · 5</p>
              </div>

              <div className="hidden min-w-0 md:block md:border-l md:border-line md:pl-6">
                <p className="text-[0.8125rem] font-semibold">Pipeline</p>
                <ul className="mt-3 space-y-2">
                  {STAGES.map(([name, n]) => (
                    <li key={name} className="grid grid-cols-[4.5rem_1fr_1rem] items-center gap-2 text-[0.75rem]">
                      <span className="text-ink-2">{name}</span>
                      <span className="relative block h-[3px] rounded-full bg-[var(--line)]">
                        <span className="absolute inset-y-0 left-0 block rounded-full bg-[var(--ink-3)]" style={{ width: `${(n / 12) * 100}%` }} />
                      </span>
                      <span className="tnum text-right font-medium">{n}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-[0.8125rem] font-semibold">What changed</p>
                <ul className="mt-2 space-y-2">
                  {[["Vercel", "Recruiter reached out"], ["Ramp", "Offer"]].map(([c, l]) => (
                    <li key={c}>
                      <p className="text-[0.8125rem] font-medium">{c}</p>
                      <p className="text-[0.75rem] text-ink-2">{l}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
