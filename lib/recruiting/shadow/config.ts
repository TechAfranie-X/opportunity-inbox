import { FROZEN } from "./frozen.ts";

/**
 * Shadow-mode configuration. Dependency-free on purpose: the product's sync action reads this on every sync, and a
 * disabled flag must not pull the reader pipeline into the server bundle.
 *
 * Only the on/off flag comes from the environment. The cutoff and the sampling rate are FROZEN constants: they cannot be
 * mis-set, and a historical message cannot be classified as prospective by a stray variable.
 */
export type ShadowConfig = {
  enabled: boolean;
  /** Messages arriving at or after this instant belong to the prospective cohort. */
  cutoff: Date;
  /** Fraction of non-census mail assigned to the uniform sample arm. */
  uniformRate: number;
};

export const FROZEN_CUTOFF = new Date(FROZEN.cutoff);

export function readShadowConfig(env: Record<string, string | undefined> = process.env): ShadowConfig {
  return { enabled: env.READER_V2_SHADOW === "1", cutoff: FROZEN_CUTOFF, uniformRate: FROZEN.uniformRate };
}
