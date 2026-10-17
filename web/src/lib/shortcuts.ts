import { useEffect } from "react";

/**
 * Two shortcuts, the two a reader reaches for on a long page: `/` to search the
 * word index, `f` to open the filters. Neither fires while a field has focus,
 * and neither overrides a browser or OS modifier.
 */

export const WORD_SEARCH_ID = "word-search";
export const OPEN_FILTERS_EVENT = "dash:open-filters";

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      if (event.key === "/") {
        const search = document.getElementById(WORD_SEARCH_ID);
        if (!search) return;
        event.preventDefault();
        search.focus();
        if (search instanceof HTMLInputElement) search.select();
      } else if (event.key === "f") {
        event.preventDefault();
        window.dispatchEvent(new Event(OPEN_FILTERS_EVENT));
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
