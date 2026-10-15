/**
 * The last few messages (§11.8) — the only place a viewer sees bodies, and the
 * cheapest honest signal that the pipeline is still running. `show_recent = 0`
 * means the API sends an empty list and this renders nothing at all.
 */
export function RecentStrip({
  messages,
  truncated,
}: {
  messages: { author: string; created_at: string; body: string }[];
  truncated?: boolean;
}) {
  if (!messages.length) return null;
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <h2 className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Last {messages.length} messages {truncated ? "(truncated)" : ""}
      </h2>
      <ul className="space-y-1 text-xs">
        {messages.map((message, index) => (
          <li key={`${message.created_at}-${index}`} className="flex gap-2">
            <span className="shrink-0 font-medium text-[var(--color-text)]">{message.author}</span>
            <time className="shrink-0 text-[var(--color-muted)]" dateTime={message.created_at}>
              {message.created_at.slice(0, 16).replace("T", " ")}
            </time>
            <span className="truncate text-[var(--color-muted)]">{message.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
