// The 搬砖小鹅 Goooose lockup. Per the VI the coral accent lands on 鹅 and on the
// four o's — the name's own joke. Callers pass sizing; the faces are fixed here so
// the six places this appears can't drift apart.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-brand">
        搬砖小<span className="text-poet-deep">鹅</span>
      </span>{" "}
      <span className="font-display italic">
        G<span className="text-poet-deep">oooo</span>se
      </span>
    </span>
  );
}
