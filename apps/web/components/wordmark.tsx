// The 搬砖小鹅 Goooose lockup. Per the VI the coral accent lands on 鹅 and on the
// four o's — the name's own joke. Callers pass sizing; the faces are fixed here so
// the six places this appears can't drift apart.
//
// The o's are four separate spans (not one "oooo") so they can bob in sequence on
// hover — one long honk travelling through the word. inline-block is required for
// the transform to apply at all.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark${className ? ` ${className}` : ""}`}>
      <span className="font-brand">
        搬砖小<span className="text-poet-deep">鹅</span>
      </span>{" "}
      <span className="font-display italic">
        G
        <span className="honk-o inline-block text-poet-deep">o</span>
        <span className="honk-o inline-block text-poet-deep">o</span>
        <span className="honk-o inline-block text-poet-deep">o</span>
        <span className="honk-o inline-block text-poet-deep">o</span>
        se
      </span>
    </span>
  );
}
