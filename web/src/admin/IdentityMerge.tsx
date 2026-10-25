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
 *
 * This file holds the state and the writes; the rules live in `merges.ts`, and
 * the cards, the picker and the suggestions each draw one part of the screen.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { Author, Payload } from "../api/types";
import { EmptyState } from "../components/Panel";
import { RebuildRequired } from "./Rebuild";
import { putIdentity, type MergeEntry } from "./api";
import { AbsorbConfirm, MergeCard } from "./MergeCard";
import { MergePicker, type NameChoice } from "./MergePicker";
import { MergeSuggestions } from "./MergeSuggestions";
import {
  addAlt,
  adminNote,
  foldSuggestion,
  mergeDirectory,
  mergePair,
  mergesFromPayload,
  mergesFromWire,
  removeAlt,
  suggestMerges,
  wireFrom,
  type Absorb,
  type Merge,
} from "./merges";
import { Notice, SubSection } from "./shared";
import { useAction } from "./useAction";

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
  const [nameChoice, setNameChoice] = useState<NameChoice | null>(null);
  const [customName, setCustomName] = useState("");
  const { busy: saving, notice, error, run, setNotice, setError } = useAction();
  const [undoes, setUndoes] = useState<MergeEntry[] | null>(null);
  /** Pins the last write introduced, so undo can drop them (§11.6). */
  const [undoClear, setUndoClear] = useState<string[]>([]);
  const [absorbing, setAbsorbing] = useState<Absorb | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [rebuildWhy, setRebuildWhy] = useState<string | null>(null);

  useEffect(() => {
    setMerges(mergesFromPayload(payload));
  }, [payload]);

  // The absorb confirmation is inline, not a modal, so without this a screen
  // reader hears nothing when it appears. Focusing the confirm button announces
  // it and gives the keyboard a safe next Tab.
  useEffect(() => {
    if (absorbing) confirmRef.current?.focus();
  }, [absorbing]);

  const identities: Author[] = payload?.authors ?? [];
  const people = useMemo(() => mergeDirectory(identities, merges), [identities, merges]);
  const { label, canonicalFor, messagesOf, membersOf, headsAnIdentity } = people;
  const suggestions = useMemo(
    () => suggestMerges(identities, people.mergedInto),
    [identities, people],
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
    await run(async () => {
      // Immediate and conservative: a write is going out, so the cache may be
      // stale until a rebuild (§11.6).
      onDirty();
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
    });
  }

  /** Puts the set back to what it was before the last write. */
  async function undo() {
    if (!undoes) return;
    const previous = undoes;
    await run(async () => {
      onDirty();
      const written = await putIdentity(previous, undoClear);
      setUndoes(null);
      setUndoClear([]);
      setMerges(mergesFromWire(written.merges));
      setRebuildWhy("A rebuild is required to apply the undo.");
      setNotice("Undone — the merge set is back to what it was before that change.");
    });
  }

  function mergeSelected() {
    if (!pickA || !pickB || pickA === pickB) return;
    if (alreadyOne) {
      setError("those two accounts are already the same person");
      return;
    }
    const { next, accounts } = mergePair(merges, membersOf, identityA, identityB, winner);
    setPickA("");
    setPickB("");
    setCustomName("");
    void persist(
      next,
      `Merged ${accounts} accounts into ${winnerName}.`,
      { canonical: winner, name: winnerName },
      "A rebuild is required to apply the merge.",
    );
  }

  function askToAddAlt(canonical: string) {
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

  function applyAddAlt(canonical: string, account: string, wholeIdentity = false) {
    const { next, moved } = addAlt(merges, canonical, account, wholeIdentity);
    setAltFor((current) => ({ ...current, [canonical]: "" }));
    setAbsorbing(null);
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

  function unmerge(canonical: string, account: string) {
    void persist(
      removeAlt(merges, canonical, account),
      `Unmerged ${label(account)} from ${label(canonical)}.`,
    );
  }

  function mergeSuggestion(a: Author, b: Author) {
    const { next, keep, fold } = foldSuggestion(merges, a, b);
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
        <AbsorbConfirm
          absorbing={absorbing}
          people={people}
          saving={saving}
          confirmRef={confirmRef}
          onConfirm={confirmAbsorb}
          onCancel={() => setAbsorbing(null)}
        />
      ) : null}

      <div className="space-y-3">
        {merges.length === 0 ? (
          <EmptyState>No merges yet — every account stands alone.</EmptyState>
        ) : null}
        {merges.map((merge) => (
          <MergeCard
            key={merge.canonical}
            merge={merge}
            people={people}
            saving={saving}
            alt={altFor[merge.canonical] ?? ""}
            onAltChange={(account) =>
              setAltFor((current) => ({ ...current, [merge.canonical]: account }))
            }
            onAddAlt={() => askToAddAlt(merge.canonical)}
            onRemoveAlt={(account) => unmerge(merge.canonical, account)}
          />
        ))}
      </div>

      <MergePicker
        people={people}
        identities={identities}
        picks={{
          pickA,
          pickB,
          identityA,
          identityB,
          alreadyOne,
          choice,
          nameChoice,
          customName,
          winnerName,
        }}
        saving={saving}
        canUndo={Boolean(undoes)}
        onPickA={setPickA}
        onPickB={setPickB}
        onNameChoice={setNameChoice}
        onCustomName={(name) => {
          setCustomName(name);
          setNameChoice("custom");
        }}
        onMerge={mergeSelected}
        onUndo={undo}
      />

      <MergeSuggestions suggestions={suggestions} saving={saving} onMerge={mergeSuggestion} />
    </SubSection>
  );
}
