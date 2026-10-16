/**
 * Identity merge (§11.6, §5.5): one card per merge, the canonical account with
 * its alts as removable chips, an "add alt" affordance, and the name-heuristic
 * suggestions with a Merge button.
 *
 * The heuristic only ever *suggests*: it produces false positives on short or
 * common handles, so a human presses Merge.
 *
 * Every one of those actions writes the whole merge set through
 * `PUT /api/admin/identity` — the endpoint replaces, so an unmerge is the same
 * call without the alt. A write that fails is shown and the list is put back to
 * what the server still has; a merge that merely looked applied would be worse
 * than no merge at all.
 *
 * The message box below is the one place the admin API returns message text
 * (§4.4) — it is here to check whether a suggested alt really is the same
 * person, and it is labelled as the exception rather than hidden.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { Author, Payload } from "../api/types";
import { EmptyState } from "../components/Panel";
import { putIdentity, searchMessages, type MergeEntry } from "./api";
import { Notice, Section, formatStamp } from "./shared";

type Merge = { canonical: string; members: string[] };

function mergesFromPayload(payload: Payload | null): Merge[] {
  if (!payload) return [];
  return payload.identities.map((group) => ({
    canonical: group.canonical,
    members: group.members.filter((member) => member !== group.canonical),
  }));
}

/** The API stores the canonical account inside `accounts`; the cards do not. */
function wireFrom(merges: Merge[]): MergeEntry[] {
  return merges.map((merge) => ({
    canonical: merge.canonical,
    accounts: [merge.canonical, ...merge.members],
  }));
}

function mergesFromWire(merges: MergeEntry[]): Merge[] {
  return merges.map((merge) => ({
    canonical: merge.canonical,
    members: merge.accounts.filter((account) => account !== merge.canonical),
  }));
}

/** Normalised for comparison: case and punctuation are noise in a handle. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function longestSharedSubstring(a: string, b: string): number {
  let best = 0;
  const previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return best;
}

/** Spec §5.5: containment (min 4 chars) or a shared run of ≥5 covering ≥55%. */
export function suggestsSamePerson(a: string, b: string): boolean {
  const left = normalise(a);
  const right = normalise(b);
  if (left.length < 4 || right.length < 4) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const shorter = left.length <= right.length ? left : right;
  const shared = longestSharedSubstring(left, right);
  return shared >= 5 && shared / shorter.length >= 0.55;
}

export function IdentityMerge({
  payload,
  onDirty,
}: {
  payload: Payload | null;
  onDirty: () => void;
}) {
  const [merges, setMerges] = useState<Merge[]>(() => mergesFromPayload(payload));
  const [altFor, setAltFor] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMerges(mergesFromPayload(payload));
  }, [payload]);

  const identities: Author[] = payload?.authors ?? [];
  const names = useMemo(
    () => new Map(identities.map((author) => [author.id, author.name])),
    [identities],
  );
  const label = (id: string) => names.get(id) ?? id;
  // A raw alt has no display name of its own in the payload, so it is shown by
  // its account id — which is what the operator has to reason about anyway.
  const chipLabel = (id: string) => (names.has(id) ? label(id) : `account ${id}`);

  const mergedInto = useMemo(() => {
    const map = new Map<string, string>();
    for (const merge of merges) {
      map.set(merge.canonical, merge.canonical);
      for (const member of merge.members) map.set(member, merge.canonical);
    }
    return map;
  }, [merges]);

  const suggestions = useMemo(() => {
    const found: { a: Author; b: Author }[] = [];
    for (let i = 0; i < identities.length; i += 1) {
      for (let j = i + 1; j < identities.length; j += 1) {
        const a = identities[i];
        const b = identities[j];
        if (mergedInto.get(a.id) === mergedInto.get(b.id) && mergedInto.has(a.id)) continue;
        if (suggestsSamePerson(a.name, b.name)) found.push({ a, b });
      }
    }
    return found.slice(0, 6);
  }, [identities, mergedInto]);

  const everyAccount = useMemo(() => {
    const set = new Set<string>();
    for (const author of identities) {
      set.add(author.id);
      for (const account of author.accounts ?? []) set.add(account);
    }
    return [...set].sort();
  }, [identities]);

  const available = everyAccount.filter(
    (account) => mergedInto.get(account) === undefined || mergedInto.get(account) === account,
  );

  /**
   * Writes the whole set, because the endpoint replaces rather than patches.
   * `next` is what the page will show if the call lands; `merges` itself is only
   * ever moved to what the server answered, so a failed call leaves the list
   * showing the server's last known state rather than a merge that is not there.
   */
  async function persist(next: Merge[], message: string) {
    setSaving(true);
    setNotice(null);
    setError(null);
    // Immediate and conservative: a write is going out, so the cache may be
    // stale until a rebuild (§11.6).
    onDirty();
    try {
      const written = await putIdentity(wireFrom(next));
      if (written.cache_stale) onDirty();
      setMerges(mergesFromWire(written.merges));
      setNotice(`${message} The cache is stale until you run Recalculate all.`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function addAlt(canonical: string) {
    const account = altFor[canonical];
    if (!account) return;
    const next = merges.map((merge) =>
      merge.canonical === canonical && !merge.members.includes(account)
        ? { ...merge, members: [...merge.members, account] }
        : merge,
    );
    setAltFor((current) => ({ ...current, [canonical]: "" }));
    void persist(next, `Merged ${label(account)} into ${label(canonical)}.`);
  }

  function removeAlt(canonical: string, account: string) {
    // Dropping the last alt drops the merge: an account merged with nobody is
    // not a merge, and the endpoint stores only what is in the set.
    const next = merges
      .map((merge) =>
        merge.canonical === canonical
          ? { ...merge, members: merge.members.filter((member) => member !== account) }
          : merge,
      )
      .filter((merge) => merge.members.length > 0);
    void persist(next, `Unmerged ${label(account)} from ${label(canonical)}.`);
  }

  function mergeSuggestion(a: Author, b: Author) {
    const [keep, fold] = a.msgs >= b.msgs ? [a, b] : [b, a];
    const existing = merges.find((merge) => merge.canonical === keep.id);
    const folded = merges.find((merge) => merge.canonical === fold.id);
    const members = new Set([...(existing?.members ?? [])]);
    members.add(fold.id);
    for (const account of fold.accounts ?? []) members.add(account);
    for (const account of folded?.members ?? []) members.add(account);
    members.delete(keep.id);
    const next = merges.filter(
      (merge) => merge.canonical !== keep.id && merge.canonical !== fold.id,
    );
    next.push({ canonical: keep.id, members: [...members].sort() });
    void persist(next, `Merged ${fold.name} into ${keep.name}.`);
  }

  if (!payload) {
    return (
      <Section id="identity-merge" title="Identity merge">
        <EmptyState>
          The identity list needs the viewer payload, which is unavailable right now.
        </EmptyState>
      </Section>
    );
  }

  return (
    <Section id="identity-merge" title="Identity merge">
      {error ? (
        <Notice tone="error">
          Not saved: {error}. The list below is what the server still has, so switch the merge again
          once the API is reachable.
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="ok">{notice}</Notice>
      ) : null}

      <div className="space-y-3">
        {merges.length === 0 ? (
          <EmptyState>No merges yet — every account stands alone.</EmptyState>
        ) : null}
        {merges.map((merge) => (
          <article
            key={merge.canonical}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
          >
            <h3 className="text-sm font-semibold">{label(merge.canonical)}</h3>
            <p className="text-[11px] text-[var(--color-muted)]">
              canonical {merge.canonical} · {merge.members.length + 1} accounts
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {merge.members.map((member) => (
                <li key={member}>
                  <button
                    type="button"
                    onClick={() => removeAlt(merge.canonical, member)}
                    disabled={saving}
                    aria-label={`Remove alt ${label(member)} (${member})`}
                    className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] disabled:opacity-50"
                  >
                    {chipLabel(member)} ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor={`add-alt-${merge.canonical}`}
                  className="block text-[11px] text-[var(--color-muted)]"
                >
                  Add an alt account to {label(merge.canonical)}
                </label>
                <select
                  id={`add-alt-${merge.canonical}`}
                  value={altFor[merge.canonical] ?? ""}
                  onChange={(event) =>
                    setAltFor((current) => ({ ...current, [merge.canonical]: event.target.value }))
                  }
                  className="mt-1 rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
                >
                  <option value="">Choose an account…</option>
                  {available
                    .filter((account) => account !== merge.canonical)
                    .filter((account) => !merge.members.includes(account))
                    .map((account) => (
                      <option key={account} value={account}>
                        {label(account)} ({account})
                      </option>
                    ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => addAlt(merge.canonical)}
                disabled={saving || !altFor[merge.canonical]}
                className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
              >
                + add alt
              </button>
            </div>
          </article>
        ))}
      </div>

      <section
        aria-labelledby="admin-suggestions-heading"
        className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      >
        <h3 id="admin-suggestions-heading" className="text-sm font-semibold">
          Suggestions from the name heuristic
        </h3>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Name containment (4+ characters) or a shared run of 5+ covering most of the shorter name
          (§5.5). Never merged automatically — short and common handles produce false positives.
        </p>
        <ul className="mt-3 space-y-2">
          {suggestions.length === 0 ? (
            <li className="text-xs text-[var(--color-muted)]">No suggestions left.</li>
          ) : null}
          {suggestions.map(({ a, b }) => {
            const keep = a.msgs >= b.msgs ? a : b;
            const fold = keep === a ? b : a;
            return (
              <li
                key={`${a.id}-${b.id}`}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)]/50 pb-2 text-xs"
              >
                <span>
                  {a.name} <span className="text-[var(--color-muted)]">↔</span> {b.name}
                </span>
                <button
                  type="button"
                  onClick={() => mergeSuggestion(a, b)}
                  disabled={saving}
                  className="rounded border border-[var(--color-line)] px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  Merge {fold.name} into {keep.name}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <MessageSearch />
    </Section>
  );
}

/**
 * The sole admin endpoint that returns message text (§4.4). Kept to a deliberate
 * corner of the board and never rendered as part of the stats page.
 */
function MessageSearch() {
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");
  const results = useQuery({
    queryKey: ["admin", "search", submitted],
    queryFn: () => searchMessages(submitted),
    enabled: submitted.length > 0,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(term.trim());
  }

  return (
    <section
      aria-labelledby="admin-search-heading"
      className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
    >
      <h3 id="admin-search-heading" className="text-sm font-semibold">
        Message search
      </h3>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        Returns message text — the single exception to the aggregates-only rule (§4.4). Use it to
        check whether a suggested alt really is the same person.
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={submit}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="admin-search-term" className="block text-[11px] text-[var(--color-muted)]">
            Text to find
          </label>
          <input
            id="admin-search-term"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={term.trim().length === 0}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Search messages
        </button>
      </form>
      {results.isError ? (
        <div className="mt-3">
          <Notice tone="error">{(results.error as Error).message}</Notice>
        </div>
      ) : null}
      {results.data ? (
        <div className="mt-3 overflow-x-auto">
          <p className="text-[11px] text-[var(--color-muted)]">
            {results.data.total.toLocaleString()} matches; showing {results.data.rows.length}.
          </p>
          <table className="mt-2 w-full text-left text-xs">
            <caption className="sr-only">Message search results</caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                <th scope="col" className="py-1 pr-3">
                  Author
                </th>
                <th scope="col" className="py-1 pr-3">
                  When
                </th>
                <th scope="col" className="py-1">
                  Message
                </th>
              </tr>
            </thead>
            <tbody>
              {results.data.rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-line)]/50 align-top">
                  <td className="py-1 pr-3 whitespace-nowrap">{row.author_name}</td>
                  <td className="py-1 pr-3 whitespace-nowrap text-[var(--color-muted)]">
                    {formatStamp(row.created_at)}
                  </td>
                  <td className="py-1">{row.content.slice(0, 200)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
