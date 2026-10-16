/**
 * Access (§11.6, §8.1): the viewer allow-list policy, the admin Discord id, the
 * active session count, and revoke-all.
 *
 * Two of the four have no endpoint in this build — the admin id is deliberately
 * not exposed (it lives in the worker's environment beside the token), and
 * revoke-all does not exist yet. Both say so instead of offering a control that
 * would quietly do nothing.
 */

import { useEffect, useState } from "react";

import { type AdminConfig, type AdminStatus, type ConfigPatch } from "./api";
import { Def, DefList, Notice, SaveBar, Section, type SaveMode } from "./shared";

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
  onSave,
}: {
  status: AdminStatus;
  config: AdminConfig | null;
  onSave: (patch: ConfigPatch, mode: SaveMode) => Promise<AdminConfig>;
}) {
  const [policy, setPolicy] = useState(config?.effective.allowlist_policy ?? "posted");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config) setPolicy(config.effective.allowlist_policy);
  }, [config]);

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
              Who may sign in at all (§8.1). The admin id always gets in.
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
          <div className="mt-3">
            <DefList>
              <Def label="Active sessions">{status.sessions.active}</Def>
              <Def label="Admin Discord ID">not exposed</Def>
              <Def label="Overridden settings">
                {config && config.overridden.length > 0 ? config.overridden.join(", ") : "none"}
              </Def>
              <Def label="Effective admin app">{config?.effective.app_name ?? status.app}</Def>
            </DefList>
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">
            The admin id comes from the worker&rsquo;s <code>ADMIN_DISCORD_ID</code> environment
            variable and is not in any API response.
          </p>
          <div className="mt-3">
            <button
              type="button"
              disabled
              aria-describedby="revoke-all-note"
              className="rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50"
            >
              Revoke all sessions
            </button>
            <p id="revoke-all-note" className="mt-2 text-[11px] text-[var(--color-muted)]">
              Not available in this build: the API exposes no revoke-all endpoint. Signing out
              revokes your own session.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
