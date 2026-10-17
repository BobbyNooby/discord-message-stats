import type { Payload } from "../api/types";
import { isPanelId, type Dimension } from "../panels/registry";
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

/** One thing a scope named that the payload no longer has, for the banner. */
export type DroppedScope = { panelId: string; dimension: Dimension; key: string };

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
    const authorsChanged = Array.isArray((payload as { authors?: unknown }).authors);
    // The names as they were when the scope was saved: an index means nothing
    // after a rebuild, a name does.
    const savedNames: unknown[] = Array.isArray(parsed.authors) ? parsed.authors : [];

    for (const [panelId, patchValue] of Object.entries(parsed.scopes)) {
      if (!isRecord(patchValue)) continue;
      if (!isPanelId(panelId)) {
        dropped.push({ panelId, dimension: "kind", key: "scope" });
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
            active.forEach((on, index) => {
              if (!on) return;
              const name = savedNames[index];
              if (typeof name !== "string" || !name) {
                dropped.push({ panelId, dimension: "author", key: `#${index}` });
              } else if (!authors.has(name)) {
                dropped.push({ panelId, dimension: "author", key: name });
              } else {
                named.add(name);
              }
            });
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
    parts.push(`${panelId}:author=${encodeValue(names.length ? names.join(",") : "none")}`);
  }
  if (patch.word) parts.push(`${panelId}:word=${encodeValue(patch.word)}`);
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
      if (value === "none") patch.active = authors.map(() => false);
      else {
        const named = new Set(value.split(",").filter(Boolean));
        patch.active = authors.map((name) => named.has(name));
      }
    } else if (dimension === "word") {
      patch.word = value;
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

/** One line the banner can show: "author “Bob” from Share of voice, word “cat”". */
export function describeDropped(dropped: DroppedScope[], labelFor: (panelId: string) => string): string {
  return dropped
    .map((entry) => {
      const label = isPanelId(entry.panelId) ? labelFor(entry.panelId) : entry.panelId;
      return `${entry.dimension} “${entry.key}” from ${label}`;
    })
    .join(", ");
}
