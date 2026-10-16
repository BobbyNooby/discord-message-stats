/**
 * Who shows (§11.6, §5.6): every identity, its message count, and an include
 * toggle. A merge is labelled "N accounts" because that is what the operator is
 * deciding about.
 *
 * Exclusion happens at rollup build time, never in the browser — the note says
 * so out loud, because a toggle that only *looks* like it filtered the page
 * would be the quiet-wrong-numbers failure §11.6 exists to prevent.
 */

import { useMemo, useState } from "react";

import type { Payload } from "../api/types";
import { EmptyState } from "../components/Panel";
import { Notice, Section } from "./shared";

export function WhoShows({ payload }: { payload: Payload | null }) {
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  const identities = useMemo(() => {
    if (!payload) return [];
    return [...payload.authors].sort((a, b) => b.msgs - a.msgs);
  }, [payload]);

  if (!payload) {
    return (
      <Section id="who-shows" title="Who shows">
        <EmptyState>
          The identity list needs the viewer payload, which is unavailable right now.
        </EmptyState>
      </Section>
    );
  }

  const hidden = identities.filter((author) => excluded[author.id]).length;

  return (
    <Section id="who-shows" title="Who shows">
      <Notice tone="warn">
        Not saved yet: this build&rsquo;s admin API has no endpoint that writes an identity&rsquo;s
        include flag, so these toggles are staged here for review and a rebuild will not apply them.
      </Notice>

      <p className="text-xs text-[var(--color-muted)]">
        Exclusion is applied at build time: a hidden identity is removed from every rollup on the
        next rebuild, not in the browser. {hidden} of {identities.length} staged as hidden.
      </p>

      <ul className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
        {identities.map((author) => {
          const accounts = author.accounts?.length ?? 1;
          const included = !excluded[author.id];
          return (
            <li key={author.id} className="flex items-center gap-3 p-3">
              <input
                id={`who-${author.id}`}
                type="checkbox"
                checked={included}
                onChange={(event) =>
                  setExcluded((current) => ({ ...current, [author.id]: !event.target.checked }))
                }
                className="h-4 w-4"
              />
              <label htmlFor={`who-${author.id}`} className="flex-1 text-xs">
                <span className="font-medium">{author.name}</span>{" "}
                <span className="text-[var(--color-muted)]">{author.id}</span>
              </label>
              {accounts > 1 ? (
                <span
                  className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
                  title={`${accounts} raw accounts merged into this identity`}
                >
                  {accounts} accounts
                </span>
              ) : null}
              <span className="w-20 text-right text-xs tabular-nums text-[var(--color-muted)]">
                {author.msgs.toLocaleString()} msgs
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
