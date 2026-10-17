import { useQuery } from "@tanstack/react-query";

import {
  Forbidden,
  getBootstrap,
  getHealth,
  getMedia,
  getRecent,
  getWords,
  Unauthorized,
} from "./client";

/**
 * The bootstrap payload is a build artefact, not a live feed: it only changes
 * when somebody rebuilds the rollups, so refetching it on focus would be noise.
 */
export function useBootstrap() {
  return useQuery({
    queryKey: ["bootstrap"],
    queryFn: getBootstrap,
    staleTime: Infinity,
    // A refusal will not change on its own, so retrying one only delays the
    // screen that says "sign in" or "not allowed".
    retry: (attempt, error) =>
      !(error instanceof Unauthorized || error instanceof Forbidden) && attempt < 2,
  });
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 60_000 });
}

export function useRecent(enabled: boolean) {
  return useQuery({ queryKey: ["recent"], queryFn: getRecent, enabled });
}

export function useWords(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["words", query],
    queryFn: () => getWords(query),
    enabled: enabled && query.trim().length > 0,
  });
}

/**
 * One provider's and one kind's (or everyone's) top media, fetched only while
 * the top-50 view is open: the payload's own ranking is enough for the ten
 * items in the card. Both filters are the server's, so a chip narrows the whole
 * rollup rather than the fifty rows in hand.
 */
export function useMedia(provider: string | null, kind: string | null, enabled: boolean, limit = 50) {
  return useQuery({
    queryKey: ["media", provider ?? "all", kind ?? "all", limit],
    queryFn: () => getMedia(provider ?? undefined, kind ?? undefined, limit),
    enabled,
  });
}

/**
 * The kinds the scoped sidebar can offer. The list is the server's, so a kind
 * that exists only below the page limit is still a filter worth offering; it
 * shares the unfiltered `/api/media` query with the view.
 */
export function useMediaKinds(enabled: boolean) {
  return useQuery({
    queryKey: ["media", "all", "all", 50],
    queryFn: () => getMedia(undefined, undefined, 50),
    enabled,
    select: (data: { kinds: string[] }) => data.kinds,
  });
}

/** Send the browser to Discord's consent screen; this is not a fetch. */
export function loginHref(next: string): string {
  return `/auth/login?next=${encodeURIComponent(next)}`;
}
