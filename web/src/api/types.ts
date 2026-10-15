/** The payload Plan A serves — key names and array layouts are the mockup's. */

export type TypeRow = [number, string, number];

export type Author = { id: string; name: string; msgs: number; accounts?: string[] };

/** Column indices, named after the mockup's `C_*` constants. */
export const C_DAY = 0;
export const C_AUTHOR = 1;
export const C_MSGS = 2;
export const C_CHARS = 3;
export const C_REPLIES = 4;
export const C_MEDIA = 5;
export const C_EDITS = 6;

export type Cell = [number, number, number, number, number, number, number];

export type Payload = {
  meta: {
    total: number;
    source_count: number;
    stale: boolean;
    timezone: string;
    computed_at: string | null;
    authors: number;
    cells: number;
    heat_cells: number;
    active_days: number;
    firstLocal: string | null;
    lastLocal: string | null;
    stopwords: number;
    kept_words: number;
    payload_kb: number;
    payload_gzip_kb: number;
    types: TypeRow[];
  };
  authors: Author[];
  days: string[];
  cells: Cell[];
  heat: [number, number, number, number, number][];
  edges: [number, number, number][];
  response: [number, number, number][];
  editSpeed: [number, number, number][];
  starters: [number, number][];
  attachments: [string, number][];
  words: [string, number][];
  wordAuthors: Record<string, [number, number][]>;
  authorWordTotals: number[];
  authorDistinct: number[];
  identities: { canonical: string; members: string[] }[];
  linkDomains: string[];
  linkCells: [number, number, number, number][];
  topLinks: [string, number][];
  providers: [string, number][];
  embedTypes: [string, number][];
  linkStats: { msgs: number; domains: number; both: number };
  emoji: [string, number][];
  reactions: [string, number][];
  types: TypeRow[];
  tz: { name: string; label: string };
  channel_hint: string;
};
