import type { Payload, TypeRow } from "../api/types";

/**
 * Payloads for the component tests. Every builder returns a whole `Payload`
 * with nothing in it but what the test asks for, so a fixture only lists the
 * rows its assertions read. The names and ids are made up.
 */

/** Every meta field, as an empty database built in UTC would report it. */
export function testMeta(overrides: Partial<Payload["meta"]> = {}): Payload["meta"] {
  return {
    total: 0,
    source_count: 0,
    stale: false,
    can_admin: false,
    timezone: "UTC",
    timezone_mismatch: false,
    configured_timezone: "UTC",
    timezone_message: null,
    schema_version: null,
    schema_expected: 1,
    schema_message: null,
    week_start: "monday",
    time_format: "24h",
    computed_at: null,
    authors: 0,
    cells: 0,
    heat_cells: 0,
    active_days: 0,
    firstLocal: null,
    lastLocal: null,
    stopwords: 0,
    kept_words: 0,
    payload_kb: 1,
    payload_gzip_kb: 1,
    types: [],
    ...overrides,
  };
}

/** A whole payload with no rows in it. */
export function testPayload(overrides: Partial<Payload> = {}): Payload {
  return {
    meta: testMeta(),
    authors: [],
    days: [],
    cells: [],
    heat: [],
    edges: [],
    response: [],
    editSpeed: [],
    starters: [],
    attachments: [],
    words: [],
    wordAuthors: {},
    authorWordTotals: [],
    authorDistinct: [],
    identities: [],
    linkDomains: [],
    linkCells: [],
    topLinks: [],
    providers: [],
    embedTypes: [],
    linkStats: { msgs: 0, domains: 0, both: 0 },
    emoji: [],
    reactions: [],
    types: [],
    tz: { name: "UTC", label: "UTC" },
    channel_hint: "c1",
    ...overrides,
  };
}

/**
 * A four-day, two-author payload. Small on purpose: every expected number in
 * the Overview and Time tests can be checked by hand from `cells`, so a
 * regression is a wrong number rather than a moved one.
 */
export function fourDayPayload(overrides: Partial<Payload> = {}): Payload {
  return testPayload({
    meta: testMeta({
      total: 6,
      source_count: 4,
      timezone: "Europe/London",
      configured_timezone: "Europe/London",
      computed_at: "2024-01-02T00:00:00Z",
      authors: 2,
      cells: 4,
      heat_cells: 3,
      active_days: 4,
      firstLocal: "2023-01-01",
      lastLocal: "2024-01-01",
      stopwords: 12,
      kept_words: 500,
      payload_kb: 12,
      payload_gzip_kb: 3,
    }),
    authors: [
      { id: "u1", name: "Alice", msgs: 3 },
      { id: "u2", name: "Bob", msgs: 3 },
    ],
    days: ["2023-01-01", "2023-01-15", "2023-06-01", "2024-01-01"],
    cells: [
      [0, 0, 2, 10, 1, 0, 0],
      [1, 0, 1, 5, 0, 1, 0],
      [2, 1, 2, 8, 0, 0, 1],
      [3, 1, 1, 4, 1, 0, 0],
    ],
    heat: [
      [0, 9, 0, 2023, 4],
      [1, 10, 1, 2024, 2],
      [3, 20, 0, 2023, 1],
    ],
    tz: { name: "Europe/London", label: "Europe/London (UTC+0)" },
    channel_hint: "#general",
    ...overrides,
  });
}

/** The same payload with every row gone: an empty database, not a filter. */
export function emptyFourDayPayload(): Payload {
  return fourDayPayload({
    days: [],
    cells: [],
    heat: [],
    meta: { ...fourDayPayload().meta, cells: 0, heat_cells: 0, firstLocal: null, lastLocal: null },
  });
}

/**
 * One row in every array a card reads and nothing else, so every section can
 * render each of its cards without the test caring what they say.
 */
export const oneOfEach = {
  authors: [{ id: "u1", name: "A", msgs: 2 }],
  days: ["2023-01-01"],
  cells: [[0, 0, 2, 10, 1, 0, 0]],
  heat: [[0, 10, 0, 2023, 2]],
  edges: [[0, 0, 1]],
  response: [[0, 30, 1]],
  editSpeed: [[0, 12, 1]],
  starters: [[0, 1]],
  attachments: [["image/png", 1]],
  words: [["abc", 2]],
  wordAuthors: { abc: [[0, 2]] },
  authorWordTotals: [2],
  authorDistinct: [1],
  identities: [],
  linkDomains: ["x.com"],
  linkCells: [[0, 0, 0, 1]],
  topLinks: [["x.com/a", 1]],
  providers: [["YouTube", 1]],
  embedTypes: [["video", 1]],
  linkStats: { msgs: 1, domains: 1, both: 1 },
  emoji: [["😀", 1]],
  reactions: [["fire", 1]],
  types: [[0, "default", 2]],
  tz: { name: "UTC", label: "UTC" },
  channel_hint: "c1",
  meta: { types: [[0, "default", 2]], stale: false, can_admin: false, timezone: "UTC", total: 2 },
} as unknown as Payload;

/**
 * The one-author payload the dashboard tests load through the mocked API. Its
 * meta predates the timezone and schema-version fields on purpose: the page has
 * to render a payload cached before they existed.
 */
export function dashboardPayload(types: TypeRow[]): Payload {
  return {
    ...testPayload({
      authors: [{ id: "u1", name: "Ada", msgs: 2490 }],
      days: ["2024-01-01"],
      cells: [[0, 0, 2490, 100, 10, 5, 0]],
      attachments: [["image/png", 40]],
      embedTypes: [["video", 10]],
      types,
    }),
    meta: {
      total: 2490,
      source_count: 2490,
      stale: false,
      can_admin: false,
      timezone: "UTC",
      computed_at: "2026-10-17T00:00:00Z",
      authors: 1,
      cells: 1,
      heat_cells: 0,
      active_days: 1,
      firstLocal: "2024-01-01",
      lastLocal: "2024-01-01",
      stopwords: 0,
      kept_words: 0,
      payload_kb: 1,
      payload_gzip_kb: 1,
      types,
    },
  } as unknown as Payload;
}
