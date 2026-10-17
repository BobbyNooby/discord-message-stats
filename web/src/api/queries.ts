import { useQuery } from "@tanstack/react-query";

import { getBootstrap, getHealth, getMedia, getRecent, getWords, Unauthorized } from "./client";

/**
 * The bootstrap payload is a build artefact, not a live feed: it only changes
 * when somebody rebuilds the rollups, so refetching it on focus would be noise.
 */
export function useBootstrap() {
  return useQuery({
    queryKey: ["bootstrap"],
    queryFn: getBootstrap,
    staleTime: Infinity,
    retry: (attempt, error) => !(error instanceof Unauthorized) && attempt < 2,
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
 * One provider's (or everyone's) top media, fetched only while the top-50 view
 * is open: the payload's own ranking is enough for the ten items in the card.
 */
export function useMedia(provider: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["media", provider ?? "all"],
    queryFn: () => getMedia(provider ?? undefined, 50),
    enabled,
  });
}

/** Send the browser to Discord's consent screen; this is not a fetch. */
export function loginHref(next: string): string {
  return `/auth/login?next=${encodeURIComponent(next)}`;
}
