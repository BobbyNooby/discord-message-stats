/**
 * Access (§11.6, §8.1): the viewer allow-list policy, the admins list, the
 * active session count, and revoke-all.
 *
 * Admin is a control-plane row now, seeded from `ADMIN_DISCORD_ID` at boot, so
 * the operator can grant it to somebody else here rather than editing `.env` on
 * the worker and restarting it. Revoke-all ends every session but the caller's
 * own — the response says how many, which is shown rather than guessed at.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { Payload } from "../api/types";
import {
  ApiError,
  type AdminConfig,
  type AdminRow,
  type AdminStatus,
  type ConfigPatch,
  addAdmin,
  listAdmins,
  removeAdmin,
  revokeAllSessions,
} from "./api";
import { Def, DefList, Notice, SaveBar, Section, SubSection, type SaveMode } from "./shared";

const POLICIES: { value: string; label: string; hint: string }[] = [
  {
    value: "posted",
    label: "Auto — anyone who has posted",
    hint: "A member gets in after their first message has been ingested; a pure lurker never does.",
  },
  {
    value: "explicit",
    label: "Explicit list only",
    hint: "Deny by default: only accounts written to the viewer list can sign in.",
  },
];

export function Access({
  status,
  config,
  payload,
  onSave,
}: {
  status: AdminStatus;
  config: AdminConfig | null;
  payload: Payload | null;
  onSave: (patch: ConfigPatch, mode: SaveMode) => Promise<AdminConfig>;
}) {
  const queryClient = useQueryClient();
  const [policy, setPolicy] = useState(config?.effective.allowlist_policy ?? "posted");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeNotice, setRevokeNotice] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    if (config) setPolicy(config.effective.allowlist_policy);
  }, [config]);

  async function revokeAll() {
    setRevoking(true);
    setRevokeError(null);
    setRevokeNotice(null);
    try {
      const result = await revokeAllSessions();
      setRevokeNotice(
        `${result.revoked} session${result.revoked === 1 ? "" : "s"} revoked. ` +
          "You stay signed in — this ends everyone else's session, not yours.",
      );
      await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
    } catch (failure) {
      setRevokeError((failure as Error).message);
    } finally {
      setRevoking(false);
    }
  }

  async function save(mode: SaveMode) {
    setSaving(true);
    setError(null);
    try {
      await onSave({ allowlist_policy: policy }, mode);
      setNotice(
        mode === "recalculate"
          ? "Policy saved and a rebuild queued."
          : "Policy saved. The cache is stale until you run Recalculate all.",
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section id="access" title="Access">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <fieldset>
            <legend className="text-sm font-semibold">Viewer allow-list policy</legend>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Who may sign in at all (§8.1). An admin always gets in.
            </p>
            <div className="mt-3 space-y-2">
              {POLICIES.map((option) => (
                <div key={option.value} className="flex gap-2">
                  <input
                    id={`policy-${option.value}`}
                    type="radio"
                    name="allowlist-policy"
                    value={option.value}
                    checked={policy === option.value}
                    onChange={() => setPolicy(option.value)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <label htmlFor={`policy-${option.value}`} className="text-xs">
                    <span className="font-medium">{option.label}</span>
                    <span className="block text-[var(--color-muted)]">{option.hint}</span>
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
          <div className="mt-3">
            <SaveBar onSave={save} busy={saving} disabled={!config} />
          </div>
          {notice ? (
            <div className="mt-3">
              <Notice tone="ok">{notice}</Notice>
            </div>
          ) : null}
          {error ? (
            <div className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold">Sessions and identity</h3>
          {status.admin.known === false ? (
            <div className="mt-2">
              <Notice tone="warn">
                No message in this channel was posted by <code>{status.admin.discord_id}</code>. A
                typo&rsquo;d id means the configured admin has never spoken here, so check{" "}
                <code>ADMIN_DISCORD_ID</code> in the worker&rsquo;s environment and restart it.
              </Notice>
            </div>
          ) : null}
          <div className="mt-3">
            <DefList>
              <Def label="Active sessions">{status.sessions.active}</Def>
              <Def label="Configured admin">
                {status.admin.discord_id ? status.admin.discord_id : "not configured"}
              </Def>
              <Def label="Admin ID seen posting">
                {status.admin.known === null
                  ? "not configured"
                  : status.admin.known
                    ? "yes"
                    : "no"}
              </Def>
              <Def label="Overridden settings">
                {config && config.overridden.length > 0 ? config.overridden.join(", ") : "none"}
              </Def>
              <Def label="Effective admin app">{config?.effective.app_name ?? status.app}</Def>
            </DefList>
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">
            The configured admin comes from the worker&rsquo;s <code>ADMIN_DISCORD_ID</code>{" "}
            environment variable and is seeded into the database at boot. Only the id is reported
            here; the bot token&rsquo;s value stays in the worker.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={revokeAll}
              disabled={revoking}
              aria-describedby="revoke-all-note"
              className="rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50"
            >
              {revoking ? "Revoking…" : "Revoke all sessions"}
            </button>
            <p id="revoke-all-note" className="mt-2 text-[11px] text-[var(--color-muted)]">
              Signs out every other session; yours stays in, so you are not locked out of the board.
            </p>
            {revokeNotice ? (
              <div className="mt-2">
                <Notice tone="ok">{revokeNotice}</Notice>
              </div>
            ) : null}
            {revokeError ? (
              <div className="mt-2">
                <Notice tone="error">{revokeError}</Notice>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Admins payload={payload} />
    </Section>
  );
}

/**
 * The admins list (§8.1). Add somebody from the author list — the Discord id is
 * shown, because a display name is not a key — or type an id by hand. Removing
 * somebody revokes their live sessions, so the demotion bites at once.
 */
function Admins({ payload }: { payload: Payload | null }) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null);

  const authors = useMemo(
    () => (payload ? [...payload.authors].sort((a, b) => b.msgs - a.msgs) : []),
    [payload],
  );

  async function refresh() {
    try {
      const body = await listAdmins();
      setAdmins(body.admins);
      setListError(null);
    } catch (failure) {
      setListError((failure as Error).message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void refresh();
    // Load once when the Access task opens; writes refresh it themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(discordId: string, force: boolean) {
    setBusy(true);
    setNotice(null);
    setUnknown(null);
    setListError(null);
    try {
      await addAdmin(discordId, force);
      setNotice(`Added ${discordId} as an admin.`);
      setPicked("");
      setManual("");
      await refresh();
    } catch (failure) {
      // A 409 is the server saying "that id matches no message"; the operator
      // can say they meant it, so the warning carries the override.
      if (failure instanceof ApiError && failure.status === 409) setUnknown(discordId);
      else setListError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(discordId: string) {
    setBusy(true);
    setNotice(null);
    setListError(null);
    try {
      const result = await removeAdmin(discordId);
      setNotice(
        result.revoked > 0
          ? `Removed ${discordId} and revoked ${result.revoked} session${
              result.revoked === 1 ? "" : "s"
            }.`
          : `Removed ${discordId}.`,
      );
      await refresh();
    } catch (failure) {
      setListError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const candidate = manual.trim() || picked;

  return (
    <SubSection id="admins" title="Admins">
      <p className="text-xs text-[var(--color-muted)]">
        Admins can open this board. The configured admin is seeded into the database at boot; a
        second admin is granted here, and removing one revokes their sessions immediately.
      </p>

      {listError ? <Notice tone="error">{listError}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}

      {!loaded ? (
        <p className="text-xs text-[var(--color-muted)]">Loading the admin list…</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
          {admins.map((admin) => {
            const named = authors.find((author) => author.id === admin.discord_id);
            return (
              <li key={admin.discord_id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="flex-1 text-xs">
                  {named ? (
                    <>
                      <span className="font-medium">{named.name}</span>{" "}
                      <span className="text-[var(--color-muted)]">{admin.discord_id}</span>
                    </>
                  ) : (
                    <span className="font-medium">{admin.discord_id}</span>
                  )}
                </span>
                {admin.source === "config" ? (
                  <span
                    className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
                    title="Seeded from ADMIN_DISCORD_ID; the config also keeps this id an admin"
                  >
                    from ADMIN_DISCORD_ID
                  </span>
                ) : null}
                {!admin.known ? (
                  <span
                    className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200"
                    title="No message in this channel was posted by this id"
                  >
                    hasn&rsquo;t posted
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Remove admin ${admin.discord_id}`}
                  onClick={() => void remove(admin.discord_id)}
                  disabled={busy}
                  className="rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-200 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--color-muted)]">
          Add from the author list
          <select
            aria-label="Add from the author list"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            className="mt-1 block rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-text)]"
          >
            <option value="">Pick an author…</option>
            {authors.map((author) => (
              <option key={author.id} value={author.id}>
                {author.name} — {author.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          Or type a Discord id
          <input
            aria-label="Or type a Discord id"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="snowflake id"
            className="mt-1 block rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-text)]"
          />
        </label>
        <button
          type="button"
          onClick={() => void add(candidate, false)}
          disabled={busy || !candidate}
          className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Add admin
        </button>
      </div>

      {unknown ? (
        <Notice tone="warn">
          {unknown} matches no message in this channel — usually a typo. Check the id, or{" "}
          <button
            type="button"
            onClick={() => void add(unknown, true)}
            disabled={busy}
            className="underline disabled:opacity-50"
          >
            add anyway
          </button>
          .
        </Notice>
      ) : null}
    </SubSection>
  );
}
