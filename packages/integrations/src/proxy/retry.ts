import { classifyError } from "./classify";
import type { ProxyPool } from "./pool";
import type { ErrorKind, ProxySession } from "./types";

// Retries only on error kinds where a fresh session/IP can actually help.
export async function withProxyRetry<T>(
  pool: ProxyPool,
  fn: (session: ProxySession) => Promise<T>,
  opts: {
    attempts?: number;
    okBytes?: number;
    onRetry?: (attempt: number, kind: ErrorKind, err: Error) => void;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const session = pool.checkout();
    try {
      const result = await fn(session);
      pool.reportOk(session, opts.okBytes ?? 5_000);
      return result;
    } catch (err) {
      lastErr = err as Error;
      const kind = classifyError(err, (err as Error & { status?: number }).status);
      pool.reportErr(session, lastErr.message, kind);
      if (attempt < attempts && (kind === "bot_check" || kind === "consecutive_403")) {
        opts.onRetry?.(attempt, kind, lastErr);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error("proxy retry exhausted");
}
