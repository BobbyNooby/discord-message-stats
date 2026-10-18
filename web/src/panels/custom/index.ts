import type { PanelSpec } from "../registry";

/**
 * Fork-owned custom panels. Upstream ships `[]`, so the registry works
 * untouched; a fork adds its own specs here (and its components alongside),
 * without editing any built-in panel file.
 *
 * A spec follows the exact conventions the built-ins declare:
 *
 *   export const customPanels: PanelSpec[] = [
 *     {
 *       id: "recap",                    // slug of the card title; the "…"
 *       label: "Wrapped recap",         // target, scope key and URL
 *       honours: ["time", "author"],    // only dimensions whose numbers move
 *       shapes: ["bar"],                // ["bar", "pie"] only for a whole
 *       defaultShape: "bar",
 *     },
 *   ];
 *
 * Registering a spec adds the card's id, label, honours and shapes to the
 * sidebar, the scope machinery and the reach counts. The card component itself
 * lives beside this file and is rendered from the app shell, the same way the
 * built-in cards are — a fork adds that import where the sections render.
 */
export const customPanels: PanelSpec[] = [];
