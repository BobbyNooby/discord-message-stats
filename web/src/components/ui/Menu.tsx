import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
};

/**
 * A tucked-away list of actions on a card. The trigger arrives from the caller
 * so its accessible name is written where the action is known ("More actions
 * for …"), never guessed here.
 */
export function Menu({ trigger, items }: { trigger: ReactNode; items: MenuItem[] }) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[10rem] rounded border border-[var(--color-line)] bg-[var(--color-surface)] p-1 text-xs shadow-xl"
        >
          {items.map((item) => (
            <RadixMenu.Item
              key={item.label}
              onSelect={item.onSelect}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--color-surface-2)] ${
                item.destructive ? "text-red-300" : "text-[var(--color-text)]"
              }`}
            >
              {item.icon}
              {item.label}
            </RadixMenu.Item>
          ))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
