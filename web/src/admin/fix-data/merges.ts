/**
 * The identity-merge rules, kept out of the screen so each one can be read and
 * tested on its own: who counts as which person, which handles look like one
 * person, and what the whole merge set becomes after each kind of edit.
 *
 * Every edit returns the *whole* next set, because `PUT /api/admin/identity`
 * replaces rather than patches.
 */
import type { Author, Payload } from "../../api/types";
import type { AdminMove, MergeEntry } from "../api";

/** One person: the canonical account and the alts folded into it. */
export type Merge = { canonical: string; members: string[] };

/** An absorb the operator asked for that will move a whole identity, not one id. */
export type Absorb = { canonical: string; account: string };

export function adminNote(moves: AdminMove[]): string {
  return moves
    .map((move) =>
      move.configured
        ? `Admin rights followed ${move.from} into ${move.to}; ADMIN_DISCORD_ID still names ${move.from}, so change that setting too.`
        : `Admin rights followed ${move.from} into ${move.to}.`,
    )
    .join(" ");
}

export function mergesFromPayload(payload: Payload | null): Merge[] {
  if (!payload) return [];
  return payload.identities.map((group) => ({
    canonical: group.canonical,
    members: group.members.filter((member) => member !== group.canonical),
  }));
}

/** The API stores the canonical account inside `accounts`; the cards do not. */
export function wireFrom(merges: Merge[], pinned?: { canonical: string; name: string }): MergeEntry[] {
  return merges.map((merge) => ({
    canonical: merge.canonical,
    accounts: [merge.canonical, ...merge.members],
    ...(pinned && pinned.canonical === merge.canonical ? { name: pinned.name } : {}),
  }));
}

export function mergesFromWire(merges: MergeEntry[]): Merge[] {
  return merges.map((merge) => ({
    canonical: merge.canonical,
    members: merge.accounts.filter((account) => account !== merge.canonical),
  }));
}

/** Normalised for comparison: case and punctuation are noise in a handle. */
export function normalise(name: string): string {
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
 * handle under four characters always is — "bob" appears inside "bobby", and a
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

/** Who every account currently is, and the names the screen shows for them. */
export type MergeDirectory = {
  /** An identity's display name, or the id when the payload has none. */
  label: (id: string) => string;
  /** A raw alt has no display name of its own, so it is shown by its account id. */
  chipLabel: (id: string) => string;
  /** The one person an account currently belongs to. */
  canonicalFor: (account: string) => string;
  /** Every raw account of the identity a canonical id names. */
  membersOf: (canonical: string) => string[];
  messagesOf: (canonical: string) => number;
  /** Is this account the head of an identity with alts of its own? */
  headsAnIdentity: (account: string) => boolean;
  /** The raw accounts an identity folds in beside its canonical. */
  altsOf: (account: string) => string[];
  /** Account to the canonical id it is merged into (canonicals map to themselves). */
  mergedInto: Map<string, string>;
  /** Every account the payload knows, sorted. */
  everyAccount: string[];
  /** The accounts not already folded into somebody else. */
  available: string[];
};

export function mergeDirectory(identities: Author[], merges: Merge[]): MergeDirectory {
  const names = new Map(identities.map((author) => [author.id, author.name]));
  const label = (id: string) => names.get(id) ?? id;
  const mergedInto = new Map<string, string>();
  for (const merge of merges) {
    mergedInto.set(merge.canonical, merge.canonical);
    for (const member of merge.members) mergedInto.set(member, merge.canonical);
  }
  const membersOf = (canonical: string): string[] => {
    const found = merges.find((merge) => merge.canonical === canonical);
    return found ? [found.canonical, ...found.members] : [canonical];
  };
  const everyAccount = (() => {
    const set = new Set<string>();
    for (const author of identities) {
      set.add(author.id);
      for (const account of author.accounts ?? []) set.add(account);
    }
    return [...set].sort();
  })();
  return {
    label,
    chipLabel: (id) => (names.has(id) ? label(id) : `account ${id}`),
    canonicalFor: (account) => mergedInto.get(account) ?? account,
    membersOf,
    messagesOf: (canonical) => identities.find((author) => author.id === canonical)?.msgs ?? 0,
    headsAnIdentity: (account) =>
      merges.some((merge) => merge.canonical === account && merge.members.length > 0),
    altsOf: (account) => membersOf(account).filter((member) => member !== account),
    mergedInto,
    everyAccount,
    available: everyAccount.filter(
      (account) => mergedInto.get(account) === undefined || mergedInto.get(account) === account,
    ),
  };
}

export type Suggestion = { a: Author; b: Author; score: number };

/** Pairs the name heuristic would put together, strongest first, eight at most. */
export function suggestMerges(identities: Author[], mergedInto: Map<string, string>): Suggestion[] {
  const found: Suggestion[] = [];
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
}

/** Two identities become one under `winner`, every alt of both coming along. */
export function mergePair(
  merges: Merge[],
  membersOf: (canonical: string) => string[],
  identityA: string,
  identityB: string,
  winner: string,
): { next: Merge[]; accounts: number } {
  const members = new Set<string>([...membersOf(identityA), ...membersOf(identityB)]);
  members.delete(winner);
  const next = [
    ...merges.filter((merge) => merge.canonical !== identityA && merge.canonical !== identityB),
    { canonical: winner, members: [...members].sort() },
  ];
  return { next, accounts: members.size + 1 };
}

/** Adds an account to a merge, absorbing the whole identity it heads if asked. */
export function addAlt(
  merges: Merge[],
  canonical: string,
  account: string,
  wholeIdentity = false,
): { next: Merge[]; moved: number } {
  const target = merges.find((merge) => merge.canonical === canonical);
  const source = wholeIdentity ? merges.find((merge) => merge.canonical === account) : undefined;
  const members = new Set([...(target?.members ?? []), account]);
  for (const member of source?.members ?? []) members.add(member);
  members.delete(canonical);
  const next = [
    ...merges.filter((merge) => merge.canonical !== canonical && merge.canonical !== account),
    { canonical, members: [...members].sort() },
  ];
  return { next, moved: (source?.members.length ?? 0) + 1 };
}

/**
 * Takes one alt out. Dropping the last alt drops the merge: an account merged
 * with nobody is not a merge, and the endpoint stores only what is in the set.
 */
export function removeAlt(merges: Merge[], canonical: string, account: string): Merge[] {
  return merges
    .map((merge) =>
      merge.canonical === canonical
        ? { ...merge, members: merge.members.filter((member) => member !== account) }
        : merge,
    )
    .filter((merge) => merge.members.length > 0);
}

/** A suggestion taken: the busier author keeps the name and absorbs the other. */
export function foldSuggestion(
  merges: Merge[],
  a: Author,
  b: Author,
): { next: Merge[]; keep: Author; fold: Author } {
  const [keep, fold] = a.msgs >= b.msgs ? [a, b] : [b, a];
  const existing = merges.find((merge) => merge.canonical === keep.id);
  const folded = merges.find((merge) => merge.canonical === fold.id);
  const members = new Set([...(existing?.members ?? [])]);
  members.add(fold.id);
  for (const account of fold.accounts ?? []) members.add(account);
  for (const account of folded?.members ?? []) members.add(account);
  members.delete(keep.id);
  const next = merges.filter((merge) => merge.canonical !== keep.id && merge.canonical !== fold.id);
  next.push({ canonical: keep.id, members: [...members].sort() });
  return { next, keep, fold };
}
