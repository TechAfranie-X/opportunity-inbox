/** The product's own tokens (light theme), mirrored here so the film is made of the same materials. */
export const C = {
  paper: "#f8f6f2",
  tint: "#efebe4",
  ink: "#1b1a18",
  ink2: "#5a564f",
  ink3: "#7a756c",
  line: "rgba(27,26,24,0.10)",
  lineStrong: "rgba(27,26,24,0.20)",
  accent: "#1f6e6b",
  accentWash: "rgba(31,110,107,0.10)",
} as const;

export const FONT = `"Instrument Sans", -apple-system, "SF Pro Text", system-ui, sans-serif`;
/** The product layout is 1440 px wide and the film is 1920, so product-sized values scale by this. */
export const S = 1920 / 1440;
