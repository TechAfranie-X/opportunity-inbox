import type { Stage } from "../types.ts";

/**
 * Shadow-mode model reader (guide v2). Nothing here is wired into the product: it exists to measure whether a second,
 * independent reader plus deterministic verification gives a trustworthy review signal.
 */

/** The smallest event taxonomy the product acts on. follow_up and assessment_completed are expressed as status_update + stage. */
export const READER_TYPES = ["applied", "recruiter_outreach", "assessment", "interview_invite", "interview_scheduled", "status_update", "offer", "rejection", "withdrawn"] as const;
export type ReaderType = (typeof READER_TYPES)[number];
export const READER_STAGES: Stage[] = ["applied", "recruiter", "assessment", "interview", "offer", "closed"];
export const CERTAINTIES = ["high", "medium", "low"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

/** What the model is shown. Minimized and redacted; never stored. */
export type ReaderInput = {
  key: string;
  from: string; // display name and domain only
  subject: string;
  body: string; // redacted, truncated
  received: string; // ISO timestamp, used only to resolve relative dates
  threadMessages: number;
  /** Employers the deterministic resolver found evidence for. The model chooses among these or quotes one from the text. */
  candidates: Array<{ id: string; name: string }>;
};

/** One line of model output, before verification. */
export type RawReaderOutput = {
  key: string;
  recruiting: "yes" | "no";
  type: string | null;
  stage: string | null;
  company_candidate: string | null;
  company_quote: string | null;
  role_quote: string | null;
  date_quote: string | null;
  evidence_quote: string | null;
  certainty: string;
};

export type ReaderStatus = "ok" | "invalid" | "unsupported_yes";

/** What survives verification. Every value here has been checked against the message text or the candidate list. */
export type VerifiedOutput = {
  key: string;
  status: ReaderStatus;
  recruiting: boolean;
  type: ReaderType | null;
  stage: Stage | null;
  company: string | null;
  companySource: "candidate" | "quote" | null;
  role: string | null;
  dateText: string | null;
  certainty: Certainty;
  /** Hash of the normalized evidence quote and its offset in the normalized message: traceable without storing content. */
  evidence: { hash: string; offset: number } | null;
  rejections: string[];
};
