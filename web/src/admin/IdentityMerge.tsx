/**
 * Identity merge (§11.6, §5.5): merge **any two accounts** the operator picks,
 * choose which display name wins (or type one), and undo it. The name heuristic
 * is a suggestion list beside that, never the only route.
 *
 * Every action writes the whole merge set through `PUT /api/admin/identity` —
 * the endpoint replaces, so an unmerge is the same call without the alt, and the
 * response carries the state it replaced, which is what Undo writes back.
 *
 * The chosen name is sent with the merge and pinned server-side (`renamed = 1`),
 * so the next Discord rename or rebuild cannot quietly undo it. A failed write
 * is shown and the list is put back to what the server still has; a merge that
 * merely looked applied would be worse than no merge at all.
 */

import { useEffect, useMemo, useState } from "react";

import type { Author, Payload } from "../api/types";
import { EmptyState } from "../components/Panel";
import { RebuildRequired } from "./Rebuild";
import { putIdentity, type AdminMove, type MergeEntry } from "./api";
import { Notice, SubSection } from "./shared";

type Merge = { canonical: string; members: string[] };

/** An absorb the operator asked for that will move a whole identity, not one id. */
type Absorb = { canonical: string; account: string };

function adminNote(moves: AdminMove[]): string {
  return moves
    .map((move) =>
      move.configured
        ? `Admin rights followed ${move.from} into ${move.to}; ADMIN_DISCORD_ID still names ${move.from}, so change that setting too.`
        : `Admin rights followed ${move.from} into ${move.to}.`,
    )
    .join(" ");
}

function mergesFromPayload(payload: Payload | null): Merge[] {
  if (!payload) return [];
  return payload.identities.map((group) => ({
    canonical: group.canonical,
    members: group.members.filter((member) => member !== group.canonical),
  }));
}

/** The API stores the canonical account inside `accounts`; the cards do not. */
function wireFrom(merges: Merge[], pinned?: { canonical: string; name: string }): MergeEntry[] {
  return merges.map((merge) => ({
    canonical: merge.canonical,
    accounts: [merge.canonical, ...merge.members],
    ...(pinned && pinned.canonical === merge.canonical ? { name: pinned.name } : {}),
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
export const SUGGESTION_THRESHOLD = 0.55;

/**
 * How strong the case is that two handles are one person, from 0 to 1.
 *
 * Containment is the strongest evidence and scales with how much of the longer
 * name the shorter one covers; a shared run is weaker and scales with the share
 * of the shorter name it covers. Zero means "no evidence", which is what a
 * handle under four characters always is — "vei" appears inside "alice", and a
 * boolean would have called that a match.
 */
export function mergeScore(a: string, b: string): number {
  const left = normalise(a);
  const right = normalise(b);
  if (left.length < 4 || right.length < 4) return 0;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (left.includes(right) || right.includes(left)) {
    return 0.75 + 0.25 * (shorter.length / longer.length);
  }
  const shared = longestSharedSubstring(left, right);
  if (shared < 5) return 0;
  return shared / shorter.length;
}

/** The §5.5 rule as a predicate, derived from the score. */
export function suggestsSamePerson(a: string, b: string): boolean {
  return mergeScore(a, b) >= SUGGESTION_THRESHOLD;
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
  const [pickA, setPickA] = useState("");
  const [pickB, setPickB] = useState("");
  const [nameChoice, setNameChoice] = useState<"a" | "b" | "custom" | null>(null);
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoes, setUndoes] = useState<MergeEntry[] | null>(null);
  /** Pins the last write introduced, so undo can drop them (§11.6). */
  const [undoClear, setUndoClear] = useState<string[]>([]);
  const [absorbing, setAbsorbing] = useState<Absorb | null>(null);
  const [rebuildWhy, setRebuildWhy] = useState<string | null>(null);

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

  /** The one person an account currently belongs to. */
  const canonicalFor = (account: string) => mergedInto.get(account) ?? account;

  /** Every raw account of the identity a canonical id names. */
  const membersOf = (canonical: string): string[] => {
    const found = merges.find((merge) => merge.canonical === canonical);
    return found ? [found.canonical, ...found.members] : [canonical];
  };

  const messagesOf = (canonical: string) =>
    identities.find((author) => author.id === canonical)?.msgs ?? 0;

  /** Is this account the head of an identity with alts of its own? */
  const headsAnIdentity = (account: string) =>
    merges.some((merge) => merge.canonical === account && merge.members.length > 0);

  /** The raw accounts an identity folds in beside its canonical. */
  const altsOf = (account: string) => membersOf(account).filter((member) => member !== account);

  const suggestions = useMemo(() => {
    const found: { a: Author; b: Author; score: number }[] = [];
    for (let i = 0; i < identities.length; i += 1) {
      for (let j = i + 1; j < identities.length; j += 1) {
        const a = identities[i];
        const b = identities[j];
        if (mergedInto.get(a.id) === mergedInto.get(b.id) && mergedInto.has(a.id)) continue;
        const score = mergeScore(a.name, b.name);
        if (score >= SUGGESTION_THRESHOLD) found.push({ a, b, score });
      }
    }
    // Strongest first: the operator reads down until the case stops being good.
    return found.sort((left, right) => right.score - left.score).slice(0, 8);
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

  const identityA = pickA ? canonicalFor(pickA) : "";
  const identityB = pickB ? canonicalFor(pickB) : "";
  const alreadyOne = Boolean(identityA && identityA === identityB);
  const heavier = messagesOf(identityA) >= messagesOf(identityB) ? identityA : identityB;
  // Before the operator chooses, the busier account keeps its name — the same
  // rule the old heuristic used, now only a default they can override.
  const defaultChoice: "a" | "b" =
    messagesOf(identityA) >= messagesOf(identityB) ? "a" : "b";
  const choice = nameChoice ?? defaultChoice;
  /** Which identity keeps its name: the operator's choice, or the busier one. */
  const winner = choice === "a" ? identityA : choice === "b" ? identityB : heavier;
  const winnerName = choice === "custom" ? customName.trim() : label(winner);

  /**
   * Writes the whole set, because the endpoint replaces rather than patches.
   * `next` is what the page will show if the call lands; `merges` itself is only
   * ever moved to what the server answered, so a failed call leaves the list
   * showing the server's last known state rather than a merge that is not there.
   */
  async function persist(
    next: Merge[],
    message: string,
    pinned?: { canonical: string; name: string },
    rebuildWhy = "A rebuild is required to apply this change.",
  ) {
    setSaving(true);
    setNotice(null);
    setError(null);
    // Immediate and conservative: a write is going out, so the cache may be
    // stale until a rebuild (§11.6).
    onDirty();
    try {
      const written = await putIdentity(wireFrom(next, pinned));
      if (written.cache_stale) onDirty();
      setMerges(mergesFromWire(written.merges));
      // `previous: []` is a real state — "there were no merges before this one" —
      // so undo stays offered; only a page with no write yet has nothing to undo.
      setUndoes(written.previous);
      setUndoClear(pinned ? [pinned.canonical] : []);
      setRebuildWhy(rebuildWhy);
      const moved = written.admins_moved ?? [];
      setNotice(moved.length > 0 ? `${message} ${adminNote(moved)}` : message);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Puts the set back to what it was before the last write. */
  async function undo() {
    if (!undoes) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    onDirty();
    try {
      const written = await putIdentity(undoes, undoClear);
      setUndoes(null);
      setUndoClear([]);
      setMerges(mergesFromWire(written.merges));
      setRebuildWhy("A rebuild is required to apply the undo.");
      setNotice("Undone — the merge set is back to what it was before that change.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function mergeSelected() {
    if (!pickA || !pickB || pickA === pickB) return;
    if (alreadyOne) {
      setError("those two accounts are already the same person");
      return;
    }
    const members = new Set<string>([...membersOf(identityA), ...membersOf(identityB)]);
    members.delete(winner);
    const next = [
      ...merges.filter((merge) => merge.canonical !== identityA && merge.canonical !== identityB),
      { canonical: winner, members: [...members].sort() },
    ];
    setPickA("");
    setPickB("");
    setCustomName("");
    void persist(
      next,
      `Merged ${members.size + 1} accounts into ${winnerName}.`,
      { canonical: winner, name: winnerName },
      "A rebuild is required to apply the merge.",
    );
  }

  function addAlt(canonical: string) {
    const account = altFor[canonical];
    if (!account) return;
    // One freed account is one id. An account that heads an identity of its own
    // drags every one of its alts in with it, so the operator has to say so
    // before anything is written — that silent absorption is the bug.
    if (headsAnIdentity(account)) {
      setAbsorbing({ canonical, account });
      return;
    }
    applyAddAlt(canonical, account);
  }

  /** Adds an account to a merge, absorbing the whole identity it heads if asked. */
  function applyAddAlt(canonical: string, account: string, wholeIdentity = false) {
    const target = merges.find((merge) => merge.canonical === canonical);
    const source = wholeIdentity ? merges.find((merge) => merge.canonical === account) : undefined;
    const members = new Set([...(target?.members ?? []), account]);
    for (const member of source?.members ?? []) members.add(member);
    members.delete(canonical);
    const next = [
      ...merges.filter((merge) => merge.canonical !== canonical && merge.canonical !== account),
      { canonical, members: [...members].sort() },
    ];
    setAltFor((current) => ({ ...current, [canonical]: "" }));
    setAbsorbing(null);
    const moved = (source?.members.length ?? 0) + 1;
    void persist(
      next,
      `Merged ${label(account)} into ${label(canonical)}${
        moved > 1 ? `, moving ${moved} accounts` : ""
      }.`,
    );
  }

  function confirmAbsorb() {
    if (absorbing) applyAddAlt(absorbing.canonical, absorbing.account, true);
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
    void persist(next, `Merged ${fold.name} into ${keep.name}.`, {
      canonical: keep.id,
      name: keep.name,
    });
  }

  if (!payload) {
    return (
      <SubSection id="identity-merge" title="Merge accounts">
        <EmptyState>
          The identity list needs the viewer payload, which is unavailable right now.
        </EmptyState>
      </SubSection>
    );
  }

  return (
    <SubSection id="identity-merge" title="Merge accounts">
      {error ? (
        <Notice tone="error">
          Not saved: {error}. The list below is what the server still has, so switch the merge again
          once the API is reachable.
        </Notice>
      ) : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {rebuildWhy ? <RebuildRequired what={rebuildWhy} onDirty={onDirty} /> : null}

      {absorbing ? (
        <section
          role="alertdialog"
          aria-labelledby="absorb-heading"
          className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          <p id="absorb-heading">
            <strong>{label(absorbing.account)}</strong> will be merged into{" "}
            <strong>{label(absorbing.canonical)}</strong>, including its{" "}
            {altsOf(absorbing.account).length === 1 ? "alt" : "alts"}{" "}
            {altsOf(absorbing.account)
              .map((alt) => chipLabel(alt))
              .join(", ")}{" "}
            ({altsOf(absorbing.account).length}{" "}
            {altsOf(absorbing.account).length === 1 ? "account" : "accounts"}) —{" "}
            {altsOf(absorbing.account).length + 1} accounts move in all.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmAbsorb}
              disabled={saving}
              className="rounded border border-amber-400/60 px-3 py-1.5 disabled:opacity-50"
            >
              Confirm merge
            </button>
            <button
              type="button"
              onClick={() => setAbsorbing(null)}
              disabled={saving}
              className="rounded border border-[var(--color-line)] px-3 py-1.5 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
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
                        {headsAnIdentity(account)
                          ? ` — brings ${altsOf(account).length} ${
                              altsOf(account).length === 1 ? "alt" : "alts"
                            }`
                          : ""}
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
        aria-labelledby="admin-pick-heading"
        className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      >
        <h4 id="admin-pick-heading" className="text-xs font-semibold">
          Merge two accounts
        </h4>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Pick any two accounts — the suggestions below are only suggestions. The name you choose is
          pinned to the merged person, so a later Discord rename or rebuild will not change it.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="admin-merge-a" className="block text-[11px] text-[var(--color-muted)]">
              First account
            </label>
            <select
              id="admin-merge-a"
              value={pickA}
              onChange={(event) => setPickA(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
            >
              <option value="">Choose an account…</option>
              {everyAccount.map((account) => (
                <option key={account} value={account}>
                  {chipLabel(account)} ({account})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="admin-merge-b" className="block text-[11px] text-[var(--color-muted)]">
              Second account
            </label>
            <select
              id="admin-merge-b"
              value={pickB}
              onChange={(event) => setPickB(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
            >
              <option value="">Choose an account…</option>
              {everyAccount
                .filter((account) => account !== pickA)
                .map((account) => (
                  <option key={account} value={account}>
                    {chipLabel(account)} ({account})
                  </option>
                ))}
            </select>
          </div>
        </div>

        {pickA && pickB ? (
          alreadyOne ? (
            <div className="mt-3">
              <Notice tone="warn">
                {chipLabel(pickA)} and {chipLabel(pickB)} are already the same person.
              </Notice>
            </div>
          ) : (
            <fieldset className="mt-3">
              <legend className="text-[11px] text-[var(--color-muted)]">
                Which display name wins?
              </legend>
              <p className="mt-1 text-xs">
                This merges{" "}
                <strong>
                  {new Set([...membersOf(identityA), ...membersOf(identityB)]).size} accounts
                </strong>{" "}
                into <strong>{winnerName || "the name you type"}</strong>.
                {[identityA, identityB].some(headsAnIdentity)
                  ? " It drags in every alt of both identities too — check the accounts beside each name."
                  : ""}
              </p>
              <div className="mt-2 space-y-2">
                {(
                  [
                    ["a", identityA],
                    ["b", identityB],
                  ] as const
                ).map(([key, canonical]) => (
                  <div key={key} className="flex items-center gap-2">
                    <input
                      id={`admin-merge-name-${key}`}
                      type="radio"
                      name="admin-merge-name"
                      checked={choice === key}
                      onChange={() => setNameChoice(key)}
                      className="h-4 w-4"
                    />
                    <label htmlFor={`admin-merge-name-${key}`} className="text-xs">
                      Keep the name <strong>{label(canonical)}</strong>{" "}
                      <span className="text-[var(--color-muted)]">
                        ({canonical} · {messagesOf(canonical).toLocaleString()} messages ·{" "}
                        {membersOf(canonical).length}{" "}
                        {membersOf(canonical).length === 1 ? "account" : "accounts"})
                      </span>
                    </label>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <input
                    id="admin-merge-name-custom"
                    type="radio"
                    name="admin-merge-name"
                    checked={nameChoice === "custom"}
                    onChange={() => setNameChoice("custom")}
                    className="h-4 w-4"
                  />
                  <label htmlFor="admin-merge-name-custom" className="text-xs">
                    Type a name
                  </label>
                </div>
                <input
                  id="admin-merge-name"
                  aria-label="Or type a name"
                  value={customName}
                  onChange={(event) => {
                    setCustomName(event.target.value);
                    setNameChoice("custom");
                  }}
                  placeholder="A name for the merged person"
                  className="ml-6 w-full max-w-xs rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
                />
                {winnerName.trim() &&
                identities.some(
                  (author) =>
                    author.id !== identityA &&
                    author.id !== identityB &&
                    normalise(author.name) === normalise(winnerName),
                ) ? (
                  <Notice tone="warn">
                    Another person already goes by {winnerName}. The picker shows account ids
                    beside every name, so the merge is still safe — but the two will look alike in
                    the list and on the dashboard.
                  </Notice>
                ) : null}
              </div>
            </fieldset>
          )
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={mergeSelected}
            disabled={saving || !pickA || !pickB || pickA === pickB || alreadyOne}
            className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Merge these accounts
          </button>
          {undoes ? (
            <button
              type="button"
              onClick={undo}
              disabled={saving}
              className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Undo the last change
            </button>
          ) : null}
        </div>
      </section>

      <section
        aria-labelledby="admin-suggestions-heading"
        className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      >
        <h4 id="admin-suggestions-heading" className="text-xs font-semibold">
          Suggestions from the name heuristic
        </h4>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Name containment (4+ characters) or a shared run of 5+ covering most of the shorter name
          (§5.5), scored and sorted strongest first. Never merged automatically — short and common
          handles produce false positives, which is why the score is shown rather than a verdict.
        </p>
        <ul className="mt-3 space-y-2">
          {suggestions.length === 0 ? (
            <li className="text-xs text-[var(--color-muted)]">No suggestions left.</li>
          ) : null}
          {suggestions.map(({ a, b, score }) => {
            const keep = a.msgs >= b.msgs ? a : b;
            const fold = keep === a ? b : a;
            return (
              <li
                key={`${a.id}-${b.id}`}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)]/50 pb-2 text-xs"
              >
                <span>
                  {a.name} <span className="text-[var(--color-muted)]">↔</span> {b.name}{" "}
                  <span className="text-[var(--color-muted)]">
                    match {Math.round(score * 100)}%
                  </span>
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
    </SubSection>
  );
}
