/** One palette for swatches and series, so a colour means the same thing
 * everywhere (spec §11.0: charts are pure functions of data and filters —
 * including their colour). */
export const PALETTE = [
  "#5865f2",
  "#eb459e",
  "#57f287",
  "#fee75c",
  "#00b0f4",
  "#f57731",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#8bc34a",
  "#ff9800",
  "#607d8b",
];

export function swatch(index: number): string {
  return PALETTE[index % PALETTE.length];
}
