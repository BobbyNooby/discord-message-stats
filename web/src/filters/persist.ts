import type { Payload } from "../api/types";
import { isPanelId, PANELS, type Dimension } from "../panels/registry";
import type { FilterPatch, Scopes } from "./reducer";

/**
 * What survives a reload. Scopes go to `localStorage` and are mirrored into the
 * query string so a phone sees the same view; chart shapes are only ever local.
 *
 * Both keys carry an explicit version. A payload written by a version this
 * build does not know is ignored outright: half-reading it would silently
 * invent filters the reader never set.
 */
export const SCOPES_KEY = "dash.scopes.v1";
export const CHARTS_KEY = "dash.charts.v1";

export type ChartKind = "bar" | "pie";
export type Charts = Record<string, ChartKind>;

/**
 * One thing a scope named that the payload no longer has, for the banner. A
 * dropped value still has a dimension and a key ("author “Bob”"); a scope for a
 * card this build does not have has neither, so it says so rather than
 * inventing a dimension to hang the news on.
 */
export type DroppedScope =
  | { panelId: string; dimension: Dimension; key: string }
  | { panelId: string; card: true };

export type LoadedScopes = { scopes: Scopes; dropped: DroppedScope[] };

/** The URL carries author names rather than indices; the payload supplies them. */
export type UrlState = { scopes: Scopes; authors?: string[] };

/** The author names in payload order, so a rebuilt list can still be read. */
type ScopesFile = { version: 1; scopes: Scopes; authors?: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Storage is best-effort: a full or disabled localStorage must not break the page. */
function writeVersioned(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode, a full quota, or storage switched off */
  }
}

/**
 * Every scope, against the payload that is actually loaded. A dimension that
 * names an author, word or provider the payload no longer carries is dropped —
 * a scope that filters everything to nothing is a bug, not a state — and each
 * drop is returned so the banner can say what was pruned.
 */
export function loadScopes(payload: Payload, raw?: string | null): LoadedScopes {
  let source: string | null;
  if (raw === undefined) {
    try {
      source = localStorage.getItem(SCOPES_KEY);
    } catch {
      return { scopes: {}, dropped: [] };
    }
  } else {
    source = raw;
  }

  const scopes: Scopes = {};
  const dropped: DroppedScope[] = [];

  try {
    const parsed: unknown = JSON.parse(source ?? "null");
    // Anything but our own shape is ignored whole, never half-read.
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.scopes)) {
      return { scopes, dropped };
    }

    const authors = new Set(payload.authors.map((author) => author.name));
    const words = new Set((payload.words ?? []).map(([word]) => word));
    const providers = new Set((payload.providers ?? []).map(([name]) => name));
    const authorsChanged = Array.isArray((payload as { authors?: unknown }).authors);
    // The names as they were when the scope was saved: an index means nothing
    // after a rebuild, a name does.
    const savedNames: unknown[] = Array.isArray(parsed.authors) ? parsed.authors : [];

    for (const [panelId, patchValue] of Object.entries(parsed.scopes)) {
      if (!isRecord(patchValue)) continue;
      if (!isPanelId(panelId)) {
        dropped.push({ panelId, card: true });
        continue;
      }

      const patch: FilterPatch = {};
      for (const [key, value] of Object.entries(patchValue)) {
        if (key === "active") {
          if (!Array.isArray(value)) continue;
          const active = [...(value as unknown[])];
          if (savedNames.length) {
            // Names are the only stable key across a rebuild, so a scope saved
            // with them is resolved by name and anything that vanished is
            // dropped rather than left switching a card off.
            const named = new Set<string>();
            let keptAny = false;
            active.forEach((on, index) => {
              if (!on) return;
              keptAny = true;
              const name = savedNames[index];
              if (typeof name !== "string" || !name) {
                dropped.push({ panelId, dimension: "author", key: `#${index}` });
              } else if (!authors.has(name)) {
                dropped.push({ panelId, dimension: "author", key: name });
              } else {
                named.add(name);
              }
            });
            // Every name the reader kept is gone. An all-off list is the one
            // state a saved scope must not produce — the card would draw
            // nothing and read as broken rather than filtered — so the
            // dimension goes with the names, and the drops are already said.
            if (keptAny && !named.size) continue;
            patch.active = payload.authors.map((author) => named.has(author.name));
          } else if (authorsChanged && Array.isArray((payload as { authors?: unknown }).authors)) {
            // No names recorded: positions are all there is, so a shorter
            // payload truncates and whatever fell off is reported.
            for (let index = payload.authors.length; index < active.length; index += 1) {
              if (active[index]) dropped.push({ panelId, dimension: "author", key: `#${index}` });
            }
            patch.active = payload.authors.map((_, index) => Boolean(active[index] ?? true));
          } else {
            continue;
          }
          continue;
        }
        if (key === "word") {
          if (typeof value !== "string" || !value.length) continue;
          if (!words.has(value)) {
            dropped.push({ panelId, dimension: "word", key: value });
            continue;
          }
          patch.word = value;
          continue;
        }
        if (key === "provider") {
          // A provider scope is the raw name the API matches, so a rebuild that
          // dropped it must drop the scope with it, not filter the card to
          // nothing. There is no payload list of kinds to prune against, so a
          // stale kind is left for the server to answer honestly.
          if (typeof value !== "string" || !value.length) continue;
          if (!providers.has(value)) {
            dropped.push({ panelId, dimension: "provider", key: value });
            continue;
          }
          patch.provider = value;
          continue;
        }
        if (key === "kind") {
          if (typeof value !== "string" || !value.length) continue;
          patch.kind = value;
          continue;
        }
        if (key === "from" || key === "to") {
          if (typeof value === "string" || value === null) patch[key] = value;
          continue;
        }
        if (key === "years" && Array.isArray(value)) {
          patch.years = value.filter((year): year is number => typeof year === "number");
          continue;
        }
      }

      if (Object.keys(patch).length) scopes[panelId] = patch;
    }
  } catch {
    return { scopes: {}, dropped: [] };
  }

  return { scopes, dropped };
}

export function saveScopes(scopes: Scopes, authors: string[] = []): void {
  const file: ScopesFile = { version: 1, scopes, authors };
  writeVersioned(SCOPES_KEY, file);
}

export function loadCharts(raw?: string | null): Charts {
  try {
    const source = raw === undefined ? localStorage.getItem(CHARTS_KEY) : raw;
    const parsed: unknown = JSON.parse(source ?? "null");
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.charts)) return {};
    const charts: Charts = {};
    for (const [panelId, kind] of Object.entries(parsed.charts)) {
      if (!isPanelId(panelId)) continue;
      if (kind !== "bar" && kind !== "pie") continue;
      // A shape the card's spec no longer declares is dropped on the same
      // principle as a scope naming a vanished author: the registry is what
      // says a card can draw it, and a stale "pie" for a bar-only card would
      // sit in storage pretending to be a state the card cannot be in.
      if (!PANELS[panelId].shapes.includes(kind)) continue;
      charts[panelId] = kind;
    }
    return charts;
  } catch {
    return {};
  }
}

export function saveCharts(charts: Charts): void {
  writeVersioned(CHARTS_KEY, { version: 1, charts });
}

/* ---------- the url mirror ---------- */

const ENCODE: Record<string, string> = { ",": "%2C", ";": "%3B", "=": "%3D", ":": "%3A" };
const DECODE: Record<string, string> = { "%2C": ",", "%3B": ";", "%3D": "=", "%3A": ":" };

function encodeValue(value: string): string {
  // Our separators survive encodeURIComponent, so they need escaping or a value
  // containing one would split into two dimensions on the way back. The class
  // must not match the `%` the escapes themselves are made of.
  return encodeURIComponent(value).replace(/[,;=:]/g, (char) => ENCODE[char]);
}

function decodeValue(value: string): string {
  return decodeURIComponent(value.replace(/%(2C|3B|3D|3A)/gi, (match) => DECODE[match.toUpperCase()]));
}

/**
 * Author names joined for the URL. A name may hold a comma ("Smith, John"), so
 * a comma cannot also be the separator: each name is escaped on its own and the
 * pieces are joined with `|`, which `encodeValue` never leaves literal. The
 * `2|` prefix marks the layout — a link from the old comma-joined encoding has
 * no `|` and is still read the old way.
 */
function encodeAuthors(names: string[]): string {
  if (!names.length) return "none";
  return `2|${names.map(encodeValue).join("|")}`;
}

/** The names in a new-layout value, or null for a link written before it. */
function readAuthors(rawValue: string): string[] | null {
  if (rawValue === "none") return [];
  if (!rawValue.startsWith("2|")) return null;
  return rawValue
    .slice(2)
    .split("|")
    .filter(Boolean)
    .map(decodeValue);
}

/** `active` is a bitmask in state and a list of names here, so a rebuild holds. */
function encodePatch(panelId: string, patch: FilterPatch, authors: string[]): string[] {
  const parts: string[] = [];
  if (patch.years?.length) parts.push(`${panelId}:years=${encodeValue(patch.years.join(","))}`);
  if (patch.from || patch.to) {
    // A comma, not a pipe: it survives the query string without escaping.
    parts.push(`${panelId}:time=${encodeValue(`${patch.from ?? ""},${patch.to ?? ""}`)}`);
  }
  if (patch.active && !patch.active.every(Boolean)) {
    const names = patch.active
      .map((on, index) => (on ? authors[index] : null))
      .filter((name): name is string => Boolean(name));
    parts.push(`${panelId}:author=${encodeAuthors(names)}`);
  }
  if (patch.word) parts.push(`${panelId}:word=${encodeValue(patch.word)}`);
  if (patch.provider) parts.push(`${panelId}:provider=${encodeValue(patch.provider)}`);
  if (patch.kind) parts.push(`${panelId}:kind=${encodeValue(patch.kind)}`);
  return parts;
}

export function writeUrlState(state: UrlState, url?: URL): void {
  const target = url ?? new URL(window.location.href);
  const scope = Object.entries(state.scopes).flatMap(([panelId, patch]) =>
    encodePatch(panelId, patch, state.authors ?? []),
  );
  if (scope.length) target.searchParams.set("scope", scope.join(";"));
  else target.searchParams.delete("scope");
  if (!url) window.history.replaceState(null, "", target.toString());
}

/**
 * The other half of `writeUrlState`. Names are resolved against the payload, so
 * a scope restored from the URL means the same people after a rebuild.
 */
export function readUrlState(payload?: Payload, search?: string): UrlState {
  const source = search ?? window.location.search;
  const scopes: Scopes = {};
  if (!source) return { scopes };
  const params = new URLSearchParams(source);
  const scope = params.get("scope");
  if (!scope) return { scopes };

  const authors = (payload?.authors ?? []).map((author) => author.name);
  for (const entry of scope.split(";")) {
    if (!entry) continue;
    const colon = entry.indexOf(":");
    const eq = entry.indexOf("=", colon + 1);
    if (colon < 1 || eq < colon) continue;
    const panelId = entry.slice(0, colon);
    const dimension = entry.slice(colon + 1, eq);
    const value = decodeValue(entry.slice(eq + 1));
    if (!isPanelId(panelId)) continue;

    const patch: FilterPatch = scopes[panelId] ?? {};
    if (dimension === "author") {
      const names = readAuthors(entry.slice(eq + 1));
      if (names === null) {
        // Old layout: the commas are the separator, and a comma inside a name
        // was never recoverable, so decoding then splitting is all there is.
        const named = new Set(decodeValue(entry.slice(eq + 1)).split(",").filter(Boolean));
        patch.active = authors.map((name) => named.has(name));
      } else if (!names.length) {
        patch.active = authors.map(() => false);
      } else {
        const named = new Set(names);
        patch.active = authors.map((name) => named.has(name));
      }
    } else if (dimension === "word") {
      patch.word = value;
    } else if (dimension === "provider") {
      patch.provider = value;
    } else if (dimension === "kind") {
      patch.kind = value;
    } else if (dimension === "years") {
      patch.years = value
        .split(",")
        .map(Number)
        .filter((year) => Number.isFinite(year));
    } else if (dimension === "time") {
      const [from = "", to = ""] = value.split(",");
      patch.from = from || null;
      patch.to = to || null;
    }
    scopes[panelId] = patch;
  }

  return { scopes };
}

/* ---------- the media view ---------- */

/**
 * "Browse all" is a state of the view, so it lives in the URL beside the
 * scopes: Back closes it, and the link is the view (§UI/UX rule 5).
 */
export function readMediaOpen(search?: string): boolean {
  const source = search ?? window.location.search;
  return new URLSearchParams(source).get("media") === "1";
}

/** The same URL with `?media=1` set or cleared, keeping everything else. */
export function writeMediaState(open: boolean, url?: URL): string {
  const target = url ?? new URL(window.location.href);
  if (open) target.searchParams.set("media", "1");
  else target.searchParams.delete("media");
  return target.toString();
}

/** One line the banner can show: "author “Bob” from Share of voice, word “cat”". */
export function describeDropped(dropped: DroppedScope[], labelFor: (panelId: string) => string): string {
  return dropped
    .map((entry) => {
      if ("card" in entry) {
        return `a filter for “${entry.panelId}”, a card this build no longer has`;
      }
      const label = isPanelId(entry.panelId) ? labelFor(entry.panelId) : entry.panelId;
      return `${entry.dimension} “${entry.key}” from ${label}`;
    })
    .join(", ");
}
