/** One fetch wrapper, so every query fails the same way. */

export class Unauthorized extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.status === 401) throw new Unauthorized("login required");
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* a non-JSON body keeps the status line */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const getBootstrap = () => request<import("./types").Payload>("/api/bootstrap");

export const getHealth = () =>
  request<{ ok: boolean; checked_at: string; banner: "stale" | "token_dead" | null }>("/api/health");

export const getRecent = () =>
  request<{
    messages: { author: string; author_id: string; created_at: string; body: string }[];
    truncated: boolean;
  }>("/api/recent");

export const getWords = (query: string, limit = 50) =>
  request<{
    word: string;
    total: number;
    authors: { id: string; name: string; count: number }[];
  }>(`/api/words?q=${encodeURIComponent(query)}&limit=${limit}`);
