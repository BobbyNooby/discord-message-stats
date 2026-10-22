/**
 * Replace the Discord token from the board instead of editing `.env` and
 * restarting the worker.
 *
 * The value goes up once, in the request body. The server asks Discord about it
 * before keeping it, so a typo cannot replace a token that works, then stores
 * it owner-only beside the database. Nothing sends it back: the field clears
 * itself and the board only ever learns who the token belongs to.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";

import { forgetToken, getTokenCheck, saveToken, type TokenSource } from "./api";
import { Notice } from "./shared";

const SOURCE_LABEL: Record<TokenSource, string> = {
  saved: "saved from this board",
  environment: "from the environment (DISCORD_TOKEN or DISCORD_TOKEN_FILE)",
  none: "none yet — the worker is waiting for one",
};

export function TokenBox() {
  const queryClient = useQueryClient();
  const check = useQuery({ queryKey: ["admin", "token"], queryFn: getTokenCheck });
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "token"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
  };

  const save = async () => {
    const token = value.trim();
    if (!token) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await saveToken(token);
      const who = result.bot?.global_name || result.bot?.username || "the account";
      const channel = result.channel?.ok
        ? ` and can read ${result.channel.name ? `#${result.channel.name}` : "the channel"}`
        : " but cannot read the channel — check the channel id";
      setNotice(`Saved. It signs in as ${who}${channel}. The worker uses it from its next job.`);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      // Whatever happened, the value does not linger in the page.
      setValue("");
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await forgetToken();
      setNotice("Saved token removed. The worker falls back to DISCORD_TOKEN, if there is one.");
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const source = check.data?.source;
  return (
    <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      <p className="text-[11px] text-[var(--color-muted)]">
        Token in use: <span className="text-[var(--color-text)]">{source ? SOURCE_LABEL[source] : "…"}</span>
      </p>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="admin-token" className="block text-[11px] text-[var(--color-muted)]">
            New token
          </label>
          {/* A text field drawn as dots, not a password field: a password field
              that empties after a successful request is what Chrome reads as a
              login, and it would offer to save the token to the account's
              synced passwords. The data-* attributes ask the common password
              manager extensions to leave it alone too. */}
          <input
            id="admin-token"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="paste the new token"
            style={{ WebkitTextSecurity: "disc" } as CSSProperties}
            className="mt-1 min-h-9 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="min-h-9 rounded bg-[var(--color-accent)] px-3 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check & save"}
        </button>
        {source === "saved" ? (
          <button
            type="button"
            onClick={() => void forget()}
            disabled={busy}
            className="min-h-9 rounded border border-[var(--color-line)] px-3 text-xs disabled:opacity-50"
          >
            Forget saved token
          </button>
        ) : null}
      </form>
      <p className="mt-2 text-[11px] text-[var(--color-muted)]">
        Discord is asked first; a token it refuses is not saved. The token is never sent back to this page.
      </p>
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
