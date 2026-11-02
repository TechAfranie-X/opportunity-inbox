import { extractEvent } from "./extract.ts";
import type { FixtureEmail } from "./fixtures.ts";

export type Mismatch = { subject: string; field: string; expected: unknown; actual: unknown };

export type ExtractionReport = {
  total: number;
  recruiting: number;
  noise: number;
  typeAccuracy: number;
  companyAccuracy: number;
  roleAccuracy: number;
  dateAccuracy: number;
  noiseRejected: number;
  mismatches: Mismatch[];
};

/**
 * Compare extraction against labelled emails. Used on the synthetic fixture
 * corpus in CI; the same function can score a hand-labelled export of real
 * (redacted) mail during validation.
 */
export function evaluateExtraction(corpus: FixtureEmail[]): ExtractionReport {
  const mismatches: Mismatch[] = [];
  let typeOk = 0, companyOk = 0, companyN = 0, roleOk = 0, roleN = 0, dateOk = 0, dateN = 0;
  let noiseN = 0, noiseOk = 0, recruiting = 0;

  for (const { email, expected } of corpus.filter((f) => !f.email.outbound)) {
    const event = extractEvent(email);
    const miss = (field: string, exp: unknown, actual: unknown) =>
      mismatches.push({ subject: email.subject, field, expected: exp, actual });

    if (expected.type === null) {
      noiseN += 1;
      if (event === null) noiseOk += 1; else miss("noise", null, event.type);
      continue;
    }
    recruiting += 1;
    if (event?.type === expected.type) typeOk += 1; else miss("type", expected.type, event?.type ?? null);
    if (expected.company) { companyN += 1; if (event?.company === expected.company) companyOk += 1; else miss("company", expected.company, event?.company ?? null); }
    if (expected.role) { roleN += 1; if (event?.role === expected.role) roleOk += 1; else miss("role", expected.role, event?.role ?? null); }
    if (expected.hasDate) { dateN += 1; if (event?.eventDate) dateOk += 1; else miss("date", "present", null); }
  }

  const rate = (a: number, b: number) => (b === 0 ? 1 : a / b);
  return {
    total: recruiting + noiseN,
    recruiting,
    noise: noiseN,
    typeAccuracy: rate(typeOk, recruiting),
    companyAccuracy: rate(companyOk, companyN),
    roleAccuracy: rate(roleOk, roleN),
    dateAccuracy: rate(dateOk, dateN),
    noiseRejected: rate(noiseOk, noiseN),
    mismatches,
  };
}
