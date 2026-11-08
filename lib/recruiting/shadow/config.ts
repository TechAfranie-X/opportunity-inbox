/**
 * Shadow-mode configuration. Dependency-free on purpose: the product's sync action reads this on every sync, and a
 * disabled flag must not pull the reader pipeline into the server bundle.
 */
export type ShadowConfig = {
  enabled: boolean;
  /** Messages arriving at or after this instant belong to the prospective cohort. Null: everything is 'historical'. */
  cutoff: Date | null;
  /** Fraction of ALL mail assigned to the uniform sample arm (including mail the candidate query does not match). */
  uniformRate: number;
};

export function readShadowConfig(env: Record<string, string | undefined> = process.env): ShadowConfig {
  const cutoff = env.READER_V2_CUTOFF ? new Date(env.READER_V2_CUTOFF) : null;
  const rate = Number(env.READER_V2_UNIFORM_RATE ?? "0.05");
  return {
    enabled: env.READER_V2_SHADOW === "1",
    cutoff: cutoff && !Number.isNaN(cutoff.getTime()) ? cutoff : null,
    uniformRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0.05,
  };
}
