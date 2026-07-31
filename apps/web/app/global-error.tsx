"use client";

// Replaces the root layout when the layout itself throws, so it renders its own html/body and
// cannot use anything from the app shell — no fonts, no theme provider, no shared components.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          minHeight: "100svh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.25rem",
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          background: "#faf9f7",
          color: "#141413",
        }}
      >
        <h1 style={{ fontSize: "2rem", fontWeight: 600, margin: 0 }}>搬砖小鹅出了点问题</h1>
        <p style={{ margin: 0, maxWidth: "26rem", textAlign: "center", fontSize: "0.875rem", opacity: 0.7 }}>
          刷新一次通常就好。如果反复出现，把下面这行编号发给我们。
        </p>
        {error.digest ? (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.7rem", opacity: 0.6 }}>
            {error.digest}
          </span>
        ) : null}
        <button
          onClick={reset}
          style={{
            padding: "0.6rem 1.4rem",
            fontSize: "0.875rem",
            borderRadius: "0.5rem",
            border: "none",
            background: "#141413",
            color: "#faf9f7",
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </body>
    </html>
  );
}
