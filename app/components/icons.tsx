/** A small, consistent icon set (1.5px strokes, 16px). Decorative: callers give the control its accessible name. */
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IconToday = () => (
  <svg {...base}><path d="M2.5 7.2 8 2.5l5.5 4.7" /><path d="M3.8 6.4v6.6h8.4V6.4" /></svg>
);
export const IconPipeline = () => (
  <svg {...base}><path d="M3 12.5V8.5M8 12.5V3.5M13 12.5V6" /></svg>
);
export const IconReview = () => (
  <svg {...base}><circle cx="8" cy="8" r="5.5" /><path d="m5.7 8.1 1.6 1.6 3-3.2" /></svg>
);
export const IconSearch = () => (
  <svg {...base}><circle cx="7" cy="7" r="4.5" /><path d="m10.4 10.4 3 3" /></svg>
);
export const IconSettings = () => (
  <svg {...base}><circle cx="8" cy="8" r="2" /><path d="M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M3.8 12.2l1.1-1.1M11.1 4.9l1.1-1.1" /></svg>
);
export const IconCheck = () => (
  <svg {...base}><path d="m3.5 8.5 3 3 6-6.5" /></svg>
);
export const IconPencil = () => (
  <svg {...base}><path d="m10.5 3 2.5 2.5L6 12.5l-3 .5.5-3z" /></svg>
);
export const IconSlash = () => (
  <svg {...base}><circle cx="8" cy="8" r="5.5" /><path d="m4.2 4.2 7.6 7.6" /></svg>
);
export const IconArrowLeft = () => (
  <svg {...base}><path d="M13 8H3M7 4 3 8l4 4" /></svg>
);
export const IconArrowRight = () => (
  <svg {...base}><path d="M3 8h10M9 4l4 4-4 4" /></svg>
);
export const IconChevron = () => (
  <svg {...base} width={12} height={12}><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
);
export const IconLock = () => (
  <svg {...base}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></svg>
);
export const IconLayers = () => (
  <svg {...base}><path d="m8 2.5 5.5 3L8 8.5l-5.5-3z" /><path d="m2.5 8.5 5.5 3 5.5-3" /></svg>
);
export const IconTrash = () => (
  <svg {...base}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" /></svg>
);
export const IconInfo = () => (
  <svg {...base}><circle cx="8" cy="8" r="5.5" /><path d="M8 7.4v3.2M8 5.3v.1" /></svg>
);
export const IconClock = () => (
  <svg {...base}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.2" /></svg>
);
