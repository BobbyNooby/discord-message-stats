import { useMemo, useRef, useState, type Dispatch } from "react";

import type { Payload } from "../api/types";
import type { DashboardAction } from "../filters/reducer";
import { GLOBAL_SEARCH_ID } from "../lib/shortcuts";
import type { PanelId } from "../panels/registry";

/**
 * One search for the whole dashboard. It reaches into the payload's own
 * indexes — `authors`, the 500-word slice, `linkDomains` and `topMedia` — so
 * finding a person, a word, a domain or a media item never leaves the browser.
 *
 * A hit either applies the matching scope (an author narrows the view to that
 * person, a word sets the word filter) or jumps to the card that owns the
 * index, and both scroll the card into view and focus it.
 */

export type SearchHit =
  | { kind: "author"; label: string; detail: string; panelId: PanelId; authorIndex: number }
  | { kind: "word"; label: string; detail: string; panelId: PanelId; word: string }
  | { kind: "domain"; label: string; detail: string; panelId: PanelId; domain: string }
  | { kind: "media"; label: string; detail: string; panelId: PanelId; url: string };

const LIMIT = 8;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The cards each index belongs to, so a hit can take the reader there. */
const TARGETS = {
  author: "who-talks-the-most",
  word: "word-index",
  domain: "where-the-chat-lives",
  media: "most-reposted",
} as const satisfies Record<SearchHit["kind"], PanelId>;

const KIND_ORDER: SearchHit["kind"][] = ["author", "word", "domain", "media"];

/**
 * The matching hits, prefix matches first. Pure, so the ranking is testable
 * without a DOM and the component only renders what this returns.
 */
export function searchPayload(payload: Payload, rawQuery: string, limit = LIMIT): SearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const candidates: { hit: SearchHit; rank: number }[] = [];
  const push = (hit: SearchHit, text: string) => {
    const lower = text.toLowerCase();
    if (!lower.includes(query)) return;
    candidates.push({ hit, rank: lower.startsWith(query) ? 0 : 1 });
  };

  payload.authors.forEach((author, authorIndex) => {
    push(
      { kind: "author", label: author.name, detail: `${fmt(author.msgs)} messages`, panelId: TARGETS.author, authorIndex },
      author.name,
    );
  });
  for (const [word, uses] of payload.words ?? []) {
    push({ kind: "word", label: word, detail: `${fmt(uses)} uses`, panelId: TARGETS.word, word }, word);
  }
  for (const domain of payload.linkDomains ?? []) {
    push({ kind: "domain", label: domain, detail: "domain", panelId: TARGETS.domain, domain }, domain);
  }
  for (const row of payload.topMedia ?? []) {
    const label = row[3] || row[0];
    push(
      { kind: "media", label, detail: `${row[1] || "no provider"} · ${fmt(row[6])} uses`, panelId: TARGETS.media, url: row[0] },
      `${label} ${row[0]} ${row[1]}`,
    );
  }

  return candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .sort((a, b) => a.rank - b.rank || KIND_ORDER.indexOf(a.hit.kind) - KIND_ORDER.indexOf(b.hit.kind) || a.index - b.index)
    .slice(0, limit)
    .map((candidate) => candidate.hit);
}

const OPTION_ID = (index: number) => `${GLOBAL_SEARCH_ID}-option-${index}`;
const LISTBOX_ID = `${GLOBAL_SEARCH_ID}-listbox`;

export function GlobalSearch({
  payload,
  dispatch,
}: {
  payload: Payload;
  dispatch: Dispatch<DashboardAction>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => searchPayload(payload, query), [payload, query]);
  const cursor = Math.min(active, Math.max(hits.length - 1, 0));
  const expanded = open && query.trim().length > 0;

  const choose = (hit: SearchHit) => {
    if (hit.kind === "author") dispatch({ type: "onlyAuthor", index: hit.authorIndex });
    else if (hit.kind === "word") dispatch({ type: "setWord", word: hit.word });
    setQuery(hit.label);
    setOpen(false);
    const target = document.getElementById(hit.panelId);
    if (target) {
      target.scrollIntoView?.({ behavior: "smooth", block: "start" });
      target.focus?.({ preventScroll: true });
    }
  };

  return (
    <div
      ref={container}
      className="relative w-full sm:w-72"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor={GLOBAL_SEARCH_ID} className="sr-only">
        Search the dashboard
      </label>
      <input
        id={GLOBAL_SEARCH_ID}
        type="search"
        role="combobox"
        aria-label="Search the dashboard"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded && hits.length ? LISTBOX_ID : undefined}
        aria-activedescendant={expanded && hits.length ? OPTION_ID(cursor) : undefined}
        autoComplete="off"
        placeholder="Search authors, words, domains, media…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.min(current + 1, Math.max(hits.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter") {
            if (open && hits[cursor]) {
              event.preventDefault();
              choose(hits[cursor]);
            }
          } else if (event.key === "Escape") {
            // Escape closes the results and leaves the field, always.
            event.preventDefault();
            setOpen(false);
          }
        }}
        className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-muted)]"
      />

      {expanded && hits.length ? (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-auto rounded border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg"
        >
          {hits.map((hit, index) => (
            <li
              key={`${hit.kind}:${hit.label}`}
              id={OPTION_ID(index)}
              role="option"
              aria-selected={index === cursor}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(hit)}
              className={`flex cursor-pointer items-baseline justify-between gap-2 px-3 py-1.5 text-xs ${
                index === cursor ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text)]"
              }`}
            >
              <span className="min-w-0 truncate">{hit.label}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                {hit.kind} · {hit.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : expanded ? (
        <p
          role="status"
          className="absolute left-0 right-0 top-full z-40 mt-1 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-muted)]"
        >
          Nothing matches “{query.trim()}” — no author, word, domain or media item.
        </p>
      ) : null}
    </div>
  );
}
