import Link from "next/link";
import { Mark } from "@/app/components/brand";
import { JourneyLine } from "@/app/components/journey-line";

/**
 * A picture of the real product, built from the product's own styles (same hero card, rows, journey line and navigation),
 * so what the landing page promises is what the app looks like. Static on purpose: it is a preview, not a demo. The whole
 * frame opens the live demo.
 */
export function LandingPreview() {
  return (
    <Link href="/demo" aria-label="Open the live demo with sample data" className="group block rounded-[var(--r-lg)]">
      <div className="preview-frame transition-transform duration-500 group-hover:-translate-y-1" aria-hidden>
        <div className="flex items-center gap-6 border-b border-line px-5 py-3">
          <span className="flex items-center gap-2.5 text-[0.8125rem] font-semibold tracking-tight">
            <Mark />
            <span className="max-sm:hidden">Opportunity Inbox</span>
          </span>
          <span className="flex items-center gap-1 text-[0.8125rem]">
            <span className="nav-link" aria-current="page">Today</span>
            <span className="nav-link">Pipeline</span>
            <span className="nav-link max-sm:hidden">Activity</span>
          </span>
        </div>

        <div className="mx-auto max-w-[40rem] px-5 pb-10 pt-8 sm:px-8 sm:pt-10">
          <p className="text-[1.625rem] font-medium leading-[1.08] tracking-[-0.038em] sm:text-[2rem]">
            Good morning, Sam.
            <span className="block text-ink-3">3 things need you today.</span>
          </p>

          <div className="hero mt-7">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-medium tracking-tight text-ink-2">Figma</p>
              <p className="t-meta font-medium text-accent">Tomorrow</p>
            </div>
            <p className="t-title mt-3">Software Engineer Intern</p>
            <p className="t-lead mt-1 text-ink-2">Interview</p>
            <p className="mt-4 text-[1.1875rem] font-medium leading-snug tracking-tight tnum">Wednesday · 2:00 PM</p>
            <div className="mt-5 flex items-center gap-5">
              <span className="btn-primary">Open invite</span>
              <span className="link-quiet">View history →</span>
            </div>
            <div className="mt-6 max-w-[26rem]">
              <JourneyLine stage="interview" surface="tint" />
            </div>
          </div>

          <ul className="list mt-8">
            {[
              ["Now", "Reply to Datadog to book your interview", "Backend Engineer Intern"],
              ["Fri", "Cloudflare assessment", "Systems Engineer Intern"],
              ["Sat", "Your Ramp offer", "Software Engineer Intern"],
            ].map(([when, title, role]) => (
              <li key={title}>
                <div className="row !items-start !gap-4">
                  <p className={`t-meta w-[3.25rem] shrink-0 pt-[0.2rem] ${when === "Now" ? "font-semibold text-signal" : "text-ink-3"}`}>{when}</p>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium tracking-tight">{title}</p>
                    <p className="t-meta mt-0.5 truncate text-ink-2">{role}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Link>
  );
}
