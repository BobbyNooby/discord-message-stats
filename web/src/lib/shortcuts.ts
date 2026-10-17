import { useEffect } from "react";

/**
 * Two shortcuts, the two a reader reaches for on a long page: `/` to search the
 * word index, `f` to open the filters. Neither fires while a field has focus,
 * neither overrides a browser or OS modifier, and neither reaches past an open
 * modal.
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

/**
 * A modal owns the keyboard while it is open — Radix traps Tab and Escape, and
 * the page behind the scrim is inert. Opening the filter sheet behind the media
 * view, or moving the caret into the sidebar behind it, would put two focus
 * traps on one document. Both wrappers set `aria-modal`, so the modal itself is
 * the thing worth asking about.
 */
function isModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if (isModalOpen()) return;

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
