/**
 * The sole admin endpoint that returns message text (§4.4). It lives in "Fix the
 * data" because that is the only reason to read a message here: deciding whether
 * two accounts really are one person. Never rendered as part of the stats page.
 */

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { searchMessages } from "./api";
import { Notice, SubSection, formatStamp } from "./shared";

export function MessageSearch() {
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
    <SubSection id="admin-search" title="Message search">
      <p className="text-xs text-[var(--color-muted)]">
        Returns message text — the single exception to the aggregates-only rule (§4.4). Use it to
        check whether a suggested alt really is the same person.
      </p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="admin-search-term" className="block text-[11px] text-[var(--color-muted)]">
            Text to find
          </label>
          <input
            id="admin-search-term"
            type="search"
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
        <Notice tone="error">{(results.error as Error).message}</Notice>
      ) : null}
      {results.data ? (
        <div className="overflow-x-auto">
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
    </SubSection>
  );
}
