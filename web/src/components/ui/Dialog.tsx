import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The modal wrapper, applied once so no panel imports Radix directly.
 *
 * The scrim is a decorative element, not a second control: it carries no
 * accessible name and stays out of the tab order. A scrim called "Close" beside
 * a Close button is the bug that made a real click land on the wrong element.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  layer = "base",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "top" for a dialog that can open over another, so its scrim dims that one too. */
  layer?: Layer;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          aria-hidden="true"
          tabIndex={-1}
          data-testid="scrim"
          className={`fixed inset-0 ${LAYERS[layer].scrim} bg-black/60`}
        />
        <RadixDialog.Content
          aria-modal="true"
          // Radix warns when a dialog has no description; the title is enough.
          aria-describedby={undefined}
          className={`fixed left-1/2 top-1/2 ${LAYERS[layer].content} flex max-h-[85vh] w-[min(92vw,42rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] p-4 shadow-xl`}
        >
          <header className="mb-3 flex items-center justify-between gap-2">
            <RadixDialog.Title className="text-sm font-semibold text-[var(--color-text)]">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close aria-label="Close" className={CLOSE_CLASS}>
              <X size={16} aria-hidden />
            </RadixDialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? <footer className="mt-3 flex justify-end gap-2">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export type Layer = "base" | "top";

/**
 * Two layers, because one dialog can open over another (a GIF's details over
 * the top-50 view). On one shared layer the second scrim sat under the first
 * dialog, which stayed bright, with its own Close still reachable.
 */
export const LAYERS: Record<Layer, { scrim: string; content: string }> = {
  base: { scrim: "z-40", content: "z-50" },
  top: { scrim: "z-[60]", content: "z-[70]" },
};

/** 40px: the minimum target the design asks for on touch surfaces. */
const CLOSE_CLASS =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-text)]";
