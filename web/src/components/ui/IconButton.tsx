import type { ComponentPropsWithRef, ReactNode } from "react";

type IconButtonProps = Omit<ComponentPropsWithRef<"button">, "aria-label" | "children"> & {
  label: string;
  icon: ReactNode;
  variant?: "quiet" | "solid";
};

/**
 * An icon-only control. The accessible name is a required prop: an unlabelled
 * icon is invisible to anyone driving the page by name.
 */
export function IconButton({ label, icon, variant = "quiet", ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded border text-[var(--color-muted)] hover:text-[var(--color-text)] ${
        variant === "solid"
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-[var(--color-text)]"
          : "border-[var(--color-line)]"
      }`}
      {...rest}
    >
      {icon}
    </button>
  );
}
