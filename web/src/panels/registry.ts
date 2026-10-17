/**
 * What each card can honour, declared once and read by the sidebar, the cards
 * and the tests alike (§UI/UX — Panel capability declaration).
 *
 * - "…" renders iff `honours.length > 0`, so no panel guesses from a prop.
 * - the chart switch (P2) renders iff `shapes.length > 1`.
 *
 * `honours` is deliberately narrow: a dimension is listed only when the card's
 * numbers actually move with it. Offering a control that changes nothing is the
 * silent-filter failure the design set out to remove. `shapes` lists a pie only
 * where the card shows a whole; a ranked top-N or a cut-off list stays a bar.
 *
 * "A whole" means the payload ships every row of it. Two rollups qualify
 * outright: `rollup_type` has no LIMIT and every message has exactly one type,
 * and `rollup_embed_type` has one row per Discord embed kind, a closed set of
 * six. Three more are whole by construction: the two two-way splits
 * (`text-vs-media`, `replies-vs-standalone`) partition every filtered message,
 * and Share of voice covers every message that has an author.
 * The rest — providers, mime types, emoji, reactions — arrive through
 * `query.pairs(..., limit=30)`, an open vocabulary cut to its thirty biggest
 * rows (on the reference database: 30 of 678 providers, 30 of 335 emoji, 30 of
 * 89 reactions). A pie over one of those would print a full circle and a
 * denominator that is missing up to 13% of the total, so those cards are bars
 * until the payload ships an uncapped total for them.
 *
 * Ids are the slug of the card's title — one source of truth for the "…"
 * target, the scope key and the URL. The `sec-*` section headings are not
 * cards: they carry no controls and no scope, so they have no spec here.
 */

export type Dimension = "time" | "author" | "word" | "provider" | "kind" | "media";
export type ChartKind = "bar" | "pie";

export type PanelSpec = {
  /** Slug of the card title, e.g. `messages-over-time`. */
  id: string;
  /** The card's title, exactly as the header renders it. */
  label: string;
  honours: readonly Dimension[];
  shapes: readonly ChartKind[];
  defaultShape: ChartKind;
};

const TA = ["time", "author"] as const;
const A = ["author"] as const;
const W = ["word"] as const;
const WA = ["word", "author"] as const;
const RICH = ["provider", "kind", "media"] as const;
const NONE: readonly Dimension[] = [];
const BAR = ["bar"] as const;
const BAR_PIE = ["bar", "pie"] as const;

const SPECS = [
  // Overview
  { id: "stat-cards", label: "Stat cards", honours: TA, shapes: BAR, defaultShape: "bar" },
  { id: "share-of-voice", label: "Share of voice", honours: TA, shapes: BAR_PIE, defaultShape: "pie" },
  { id: "messages-per-year", label: "Messages per year", honours: TA, shapes: BAR, defaultShape: "bar" },
  {
    id: "share-of-voice-year-by-year",
    label: "Share of voice, year by year",
    honours: TA,
    shapes: BAR,
    defaultShape: "bar",
  },

  // Time & rhythm
  { id: "messages-over-time", label: "Messages over time", honours: TA, shapes: BAR, defaultShape: "bar" },
  { id: "cumulative-growth", label: "Cumulative growth", honours: TA, shapes: BAR, defaultShape: "bar" },
  { id: "how-conversational", label: "How conversational", honours: TA, shapes: BAR, defaultShape: "bar" },
  { id: "every-day-six-years", label: "Every day, six years", honours: TA, shapes: BAR, defaultShape: "bar" },
  {
    id: "when-the-chat-comes-alive",
    label: "When the chat comes alive",
    honours: TA,
    shapes: BAR,
    defaultShape: "bar",
  },
  { id: "what-time-of-day", label: "What time of day", honours: TA, shapes: BAR, defaultShape: "bar" },
  {
    id: "which-month-of-the-year",
    label: "Which month of the year",
    honours: TA,
    shapes: BAR,
    defaultShape: "bar",
  },
  { id: "who-was-talking-when", label: "Who was talking, when", honours: TA, shapes: BAR, defaultShape: "bar" },

  // People
  { id: "who-talks-the-most", label: "Who talks the most", honours: TA, shapes: BAR, defaultShape: "bar" },
  {
    id: "how-fast-people-reply",
    label: "How fast people reply",
    honours: A,
    shapes: BAR,
    defaultShape: "bar",
  },
  { id: "who-replies-to-whom", label: "Who replies to whom", honours: A, shapes: BAR, defaultShape: "bar" },
  { id: "reply-balance", label: "Reply balance", honours: A, shapes: BAR, defaultShape: "bar" },
  {
    id: "who-starts-conversations",
    label: "Who starts conversations",
    honours: A,
    shapes: BAR,
    defaultShape: "bar",
  },
  { id: "author-profile", label: "Author profile", honours: TA, shapes: BAR, defaultShape: "bar" },
  { id: "reply-matrix", label: "Reply matrix", honours: A, shapes: BAR, defaultShape: "bar" },
  {
    id: "volume-by-author-and-year",
    label: "Volume by author and year",
    honours: TA,
    shapes: BAR,
    defaultShape: "bar",
  },
  {
    id: "how-bursty-is-everyone",
    label: "How bursty is everyone",
    honours: TA,
    shapes: BAR,
    defaultShape: "bar",
  },
  { id: "who-proofreads", label: "Who proofreads", honours: TA, shapes: BAR, defaultShape: "bar" },

  // Words
  { id: "word-lift", label: "Whose word is it", honours: A, shapes: BAR, defaultShape: "bar" },
  { id: "word-index", label: "Word index", honours: W, shapes: BAR, defaultShape: "bar" },
  { id: "who-says-it", label: "Who says it", honours: WA, shapes: BAR, defaultShape: "bar" },
  { id: "word-cloud", label: "Word cloud", honours: A, shapes: BAR, defaultShape: "bar" },

  // Links & embeds
  { id: "where-the-chat-lives", label: "Where the chat lives", honours: A, shapes: BAR, defaultShape: "bar" },
  { id: "embed-providers", label: "Embed providers", honours: NONE, shapes: BAR, defaultShape: "bar" },
  { id: "most-reposted-links", label: "Most reposted links", honours: NONE, shapes: BAR, defaultShape: "bar" },
  { id: "embed-types", label: "Embed types", honours: NONE, shapes: BAR_PIE, defaultShape: "bar" },

  // Media & reactions (the rollups have no date or author dimension)
  { id: "text-vs-media", label: "Text vs media", honours: TA, shapes: BAR_PIE, defaultShape: "pie" },
  {
    id: "replies-vs-standalone",
    label: "Replies vs standalone",
    honours: TA,
    shapes: BAR_PIE,
    defaultShape: "pie",
  },
  { id: "message-types", label: "Message types", honours: NONE, shapes: BAR_PIE, defaultShape: "bar" },
  { id: "what-gets-attached", label: "What gets attached", honours: NONE, shapes: BAR, defaultShape: "bar" },
  { id: "emoji-in-text", label: "Emoji in text", honours: NONE, shapes: BAR, defaultShape: "bar" },
  { id: "reactions", label: "Reactions", honours: NONE, shapes: BAR, defaultShape: "bar" },
  { id: "chat-health", label: "Chat health", honours: TA, shapes: BAR, defaultShape: "bar" },

  // Rich media: its ranking and its provider chart are payload rollups.
  { id: "most-reposted", label: "Most reposted", honours: RICH, shapes: BAR, defaultShape: "bar" },
  {
    id: "embeds-by-provider",
    label: "Embeds by provider",
    honours: ["provider"] as const,
    shapes: BAR,
    defaultShape: "bar",
  },
] as const satisfies readonly PanelSpec[];

export type PanelId = (typeof SPECS)[number]["id"];

/** One spec, with its id narrowed to the literal the registry declared. */
export type PanelSpecLiteral = (typeof SPECS)[number];

export const PANELS: Record<PanelId, PanelSpec> = Object.fromEntries(
  SPECS.map((spec) => [spec.id, spec]),
) as unknown as Record<PanelId, PanelSpec>;

export function isPanelId(value: string): value is PanelId {
  return Object.hasOwn(PANELS, value);
}

/** The spec for a card. `id` comes from the registry or from a rendered card. */
export function specFor(id: PanelId): PanelSpecLiteral {
  // Every PanelId is a key of PANELS by construction; the cast recovers the
  // literal id so `spec.id` can be handed back to `openScope`.
  return PANELS[id] as PanelSpecLiteral;
}

/** A card's title is its identity in the payload and on screen; look it up. */
export function specForLabel(label: string): PanelSpecLiteral | undefined {
  return SPECS.find((spec) => spec.label === label);
}

/** Every card whose numbers move with this dimension, in registry order. */
export function panelsHonouring(dimension: Dimension): PanelId[] {
  return SPECS.filter((spec) => (spec.honours as readonly Dimension[]).includes(dimension)).map(
    (spec) => spec.id,
  );
}
