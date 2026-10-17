import { Link } from "lucide-react";
import { useState } from "react";

import { useNotice } from "./Notice";

/**
 * Copy the view you are looking at.
 *
 * The URL already carries the card scopes (`?scope=…`) and `?media=1`, so the
 * address *is* the view — there is nothing to serialise here. Chart shapes are
 * the one piece of saved state that lives only in localStorage, so a copy is
 * honest about what travels and what does not.
 */

/** `navigator.clipboard` needs a secure context; the textarea is the fallback. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    if (!document.execCommand("copy")) throw new Error("the browser refused the copy");
  } finally {
    document.body.removeChild(area);
  }
}

export function CopyViewLink() {
  const notify = useNotice();
  const [busy, setBusy] = useState(false);

  async function copy() {
    setBusy(true);
    try {
      await copyText(window.location.href);
      notify({
        tone: "success",
        message:
          "View link copied. Anyone signed in with access opens exactly this view — chart shapes are stored per browser and do not travel with it.",
      });
    } catch (failure) {
      notify({
        tone: "danger",
        message: `Could not copy the link (${(failure as Error).message}). Select the address bar and copy it by hand.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={busy}
      className="flex items-center gap-1 rounded border border-[var(--color-line)] px-2 py-0.5 disabled:opacity-50"
    >
      <Link size={12} aria-hidden />
      Copy view link
    </button>
  );
}
