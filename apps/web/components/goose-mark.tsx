// Brand mark: the goose from the 搬砖小鹅 VI (geometry is the source artwork's
// #goose symbol verbatim). Colors resolve from --goose-* custom properties so the
// ivory-on-dark treatment flips with .dark on its own; `tone` overrides them per
// instance, which is how the three agent geese get their own colors.
type Tone = "brand" | "clerk" | "muse" | "poet";

// The eye and trim must be overridden too: --goose-eye is ivory, tuned for the coral brand
// goose, and in dark mode --*-deep is the light-mode fill — one ramp step from the body. Left
// alone, the crew geese lose eye, beak and feet (1.2–2.5:1) and render as plain blobs. Ink
// reads on all six body values (5.0–8.5:1).
const INK = "#141413";
const TONE: Record<Tone, React.CSSProperties> = {
  brand: {},
  clerk: { "--goose-body": "var(--clerk)", "--goose-trim": INK, "--goose-eye": INK },
  muse: { "--goose-body": "var(--muse)", "--goose-trim": INK, "--goose-eye": INK },
  poet: { "--goose-body": "var(--poet)", "--goose-trim": INK, "--goose-eye": INK },
} as Record<Tone, React.CSSProperties>;

export function GooseMark({
  className,
  tone = "brand",
}: {
  className?: string;
  tone?: Tone;
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={`goose-mark${className ? ` ${className}` : ""}`}
      style={TONE[tone]}
      aria-hidden
      focusable="false"
    >
      <path d="M37 97 q-7 6 -3 12 q6 3 12 0 q3 -6 -3 -12 z" fill="var(--goose-trim)" />
      <path d="M56 99 q-7 6 -3 12 q6 3 12 0 q3 -6 -3 -12 z" fill="var(--goose-trim)" />
      <path d="M14 63 q-9 1 -9 9 q7 5 14 -2 z" fill="var(--goose-body)" />
      <ellipse cx="50" cy="72" rx="41" ry="31" fill="var(--goose-body)" />
      <path
        className="goose-wing"
        d="M33 65 Q52 79 75 67"
        fill="none"
        stroke="var(--goose-wing)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M63 71 Q55 40 82 30"
        fill="none"
        stroke="var(--goose-body)"
        strokeWidth="25"
        strokeLinecap="round"
      />
      <circle cx="86" cy="28" r="18" fill="var(--goose-body)" />
      <path d="M101 20 L120 28 L101 36 Q97 28 101 20 Z" fill="var(--goose-trim)" />
      <circle className="goose-eye" cx="91" cy="23" r="3.1" fill="var(--goose-eye)" />
    </svg>
  );
}
