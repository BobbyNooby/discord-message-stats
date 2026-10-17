import type { FilterPatch } from "../filters/reducer";
import type { Dimension } from "../panels/registry";
import { Chip } from "./ui";

/** One chip per dimension a card's applied scope is actually using. */
export function scopeChips(patch: FilterPatch): { dimension: Dimension; label: string }[] {
  const chips: { dimension: Dimension; label: string }[] = [];

  if ("years" in patch || "from" in patch || "to" in patch) {
    const parts: string[] = [];
    const years = patch.years ?? [];
    if (years.length) {
      parts.push(
        years.length === 1 ? `year ${years[0]}` : `years ${years[0]}–${years[years.length - 1]}`,
      );
    }
    if ("from" in patch || "to" in patch) {
      parts.push(`${patch.from ?? "earliest"} → ${patch.to ?? "latest"}`);
    }
    if (parts.length) chips.push({ dimension: "time", label: parts.join(" · ") });
  }

  if ("active" in patch) {
    const active = patch.active ?? [];
    chips.push({
      dimension: "author",
      label: `${active.filter(Boolean).length} of ${active.length} authors`,
    });
  }

  if ("word" in patch) {
    chips.push({ dimension: "word", label: patch.word ? `word “${patch.word}”` : "word: any" });
  }

  return chips;
}

/**
 * What is applied to this card, stated in words. The × removes that dimension
 * from the applied scope straight away — a chip that only looked removed would
 * be the invisible state the design set out to kill.
 */
export function ScopeChips({
  patch,
  onRemove,
}: {
  patch: FilterPatch;
  onRemove: (dimension: Dimension) => void;
}) {
  const chips = scopeChips(patch);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <Chip key={chip.dimension} label={chip.label} onRemove={() => onRemove(chip.dimension)} />
      ))}
    </div>
  );
}
