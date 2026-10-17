import { useEffect, useState } from "react";

/**
 * `prefers-reduced-motion`. Autoplaying media and chart animation are both
 * motion *and* mobile data, so this is read live rather than once: a reader who
 * turns the setting on mid-session sees the next render honour it.
 */
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefers(query: string): boolean {
  // jsdom has no matchMedia; a missing API means "no preference expressed".
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function useReducedMotion(query: string = REDUCED_MOTION): boolean {
  const [reduced, setReduced] = useState(() => prefers(query));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return reduced;
}
