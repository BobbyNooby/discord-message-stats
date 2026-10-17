import { AlertTriangle, Ban, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The four states a fetch can leave the reader in, drawn distinctly.
 *
 * Before this, a 403, a 500 and a dropped connection all looked like "Loading…"
 * that never finished. Each screen says what happened and what to do next.
 */

function Screen({
  icon,
  title,
  children,
  onRetry,
  retryLabel = "Try again",
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-3 p-6">
      <div className="flex items-center gap-2 text-[var(--color-text)]">
        {icon}
        <h1 className="text-base font-semibold">{title}</h1>
      </div>
      <div className="space-y-2 text-sm text-[var(--color-muted)]">{children}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-2 rounded border border-[var(--color-line)] px-3 py-2 text-xs"
        >
          <RefreshCw size={14} aria-hidden />
          {retryLabel}
        </button>
      ) : null}
    </main>
  );
}

/**
 * The payload is 600 KB and takes seconds to assemble, so the wait is real.
 * Blocks the size of the cards that are coming beat a single "Loading…" line:
 * the page does not jump when the content lands.
 */
export function DashboardSkeleton({ label = "Loading the dashboard…" }: { label?: string }) {
  return (
    <main aria-busy="true" className="mx-auto max-w-[1600px] space-y-4 p-4">
      <p role="status" className="text-sm text-[var(--color-muted)]">
        {label}
      </p>
      <div className="space-y-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[0, 1, 2].map((card) => (
              <div
                key={card}
                className="h-56 animate-pulse rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]"
              />
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}

/** A signed-in viewer who asked for `/admin` (§11.6): not an error, a boundary. */
export function Forbidden({ what = "the admin board" }: { what?: string }) {
  return (
    <Screen icon={<Ban size={18} aria-hidden />} title="Not allowed">
      <p>
        You are signed in, but this account cannot open {what}. Only an admin can — ask an admin to
        add your Discord id in the Access task of the admin board.
      </p>
      <p>
        <a className="underline" href="/">
          Back to the stats page
        </a>
      </p>
    </Screen>
  );
}

/** 5xx: the server accepted the request and then could not answer it. */
export function ServerError({ detail, onRetry }: { detail?: string; onRetry?: () => void }) {
  return (
    <Screen
      icon={<AlertTriangle size={18} aria-hidden />}
      title="The server could not build the dashboard"
      onRetry={onRetry}
    >
      <p>{detail || "Something went wrong on the server."}</p>
      <p>Nothing you did caused it. Try again in a moment; if it persists, check the server log.</p>
    </Screen>
  );
}

/** The request never reached the server at all. */
export function Offline({ onRetry }: { onRetry?: () => void }) {
  return (
    <Screen
      icon={<WifiOff size={18} aria-hidden />}
      title="You are offline"
      onRetry={onRetry}
      retryLabel="Retry"
    >
      <p>
        The dashboard needs one load from the server, and the browser could not reach it. Reconnect
        and try again.
      </p>
    </Screen>
  );
}
