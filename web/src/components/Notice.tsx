import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * A transient acknowledgement: what just happened, and what to do next.
 *
 * The dashboard has no room for an inline notice per action the way the admin
 * board does — a card has no "saved" state to sit beside — so one region at the
 * bottom of the page carries them all. It is the `Banner` primitive's tone
 * vocabulary, drawn once, rather than a toast library.
 */

export type NoticeTone = "info" | "success" | "warn" | "danger";

export type NoticeInput = {
  tone?: NoticeTone;
  /** One sentence: what happened. Say what to do next in the same sentence. */
  message: ReactNode;
  /** A control that resolves the notice, when there is one. */
  action?: ReactNode;
  /** Failures stay until dismissed; a success is allowed to fade. */
  sticky?: boolean;
};

type Notice = NoticeInput & { id: number };

const AUTO_DISMISS_MS = 8000;
/** Three at once is already more than anyone reads. */
const KEEP = 3;

const NoticeContext = createContext<((notice: NoticeInput) => void) | null>(null);

/** Outside a provider this is a no-op, so a panel test needs no harness. */
export function useNotice(): (notice: NoticeInput) => void {
  return useContext(NoticeContext) ?? (() => {});
}

const TONES: Record<NoticeTone, string> = {
  info: "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/15 text-[var(--color-text)]",
  success: "border-emerald-500/60 bg-emerald-500/15 text-emerald-100",
  warn: "border-amber-500/60 bg-amber-500/15 text-amber-100",
  danger: "border-red-500/60 bg-red-500/15 text-red-100",
};

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback(
    (input: NoticeInput) => {
      const id = nextId.current++;
      const notice: Notice = { tone: "info", ...input, id };
      setNotices((current) => [...current, notice].slice(-KEEP));
      // A failure waits for a reader; a success does not need to.
      if (!notice.sticky && notice.tone !== "danger") {
        window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      }
    },
    [dismiss],
  );

  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <NoticeRegion notices={notices} onDismiss={dismiss} />
    </NoticeContext.Provider>
  );
}

/**
 * The region itself. Nothing is drawn when there is nothing to say — an empty
 * `role="status"` would make every existing `getByRole("status")` ambiguous.
 */
export function NoticeRegion({
  notices,
  onDismiss,
}: {
  notices: Notice[];
  onDismiss: (id: number) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.tone === "danger" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full max-w-lg items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs shadow-lg ${TONES[notice.tone ?? "info"]}`}
        >
          <div className="min-w-0 flex-1">{notice.message}</div>
          <div className="flex shrink-0 items-center gap-2">
            {notice.action}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(notice.id)}
              className="flex h-6 w-6 items-center justify-center rounded text-current opacity-70 hover:opacity-100"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
