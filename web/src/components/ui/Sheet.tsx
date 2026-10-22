import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { LAYERS, type Layer } from "./Dialog";

/**
 * The same dialog, anchored to the left edge for a phone: the sidebar arrives
 * as a sheet over the page rather than a block that pushes the charts down.
 * Radix supplies the focus trap, the Escape handler and the backdrop dismiss.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
  side = "left",
  layer = "base",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Which edge the sheet slides from. The filter sidebar opens on the left. */
  side?: "left" | "right";
  /** "top" for a sheet that can open over another; see `LAYERS`. */
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
          aria-describedby={undefined}
          className={`fixed inset-y-0 ${LAYERS[layer].content} flex w-[86%] max-w-sm flex-col border-[var(--color-line)] bg-[var(--color-ink)] p-4 ${
            side === "left" ? "left-0 border-r" : "right-0 border-l"
          }`}
          style={{
            paddingTop: "max(1rem, env(safe-area-inset-top))",
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
            paddingLeft: "max(1rem, env(safe-area-inset-left))",
            paddingRight: "max(1rem, env(safe-area-inset-right))",
          }}
        >
          <header className="mb-3 flex items-center justify-between gap-2">
            <RadixDialog.Title className="text-sm font-semibold text-[var(--color-text)]">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close
              aria-label="Close"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
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
