/** The mark is the journey line in miniature: three dots on a hairline, the last one lit. */
export function Mark() {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" fill="none" aria-hidden>
      <path d="M2 5h18" stroke="currentColor" strokeOpacity="0.35" />
      <circle cx="2.5" cy="5" r="2.2" fill="currentColor" />
      <circle cx="11" cy="5" r="2.2" fill="currentColor" />
      <circle cx="19.5" cy="5" r="2.6" style={{ fill: "var(--accent)" }} />
    </svg>
  );
}
