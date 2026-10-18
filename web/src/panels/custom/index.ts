import type { ComponentType } from "react";

import type { Payload } from "../../api/types";
import type { Filters } from "../../filters/reducer";
import type { PanelSpec } from "../registry";

/**
 * Fork-owned custom panels. Upstream ships both exports empty, so the registry
 * and the dashboard work untouched; a fork adds its own specs and components
 * here (and its component files alongside), without editing any built-in panel
 * file.
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
 * sidebar, the scope machinery and the reach counts. Its card itself goes in
 * `customComponents`, keyed by the same id; `panels/CustomSection.tsx` renders
 * any spec no built-in section claims, so adding a panel is two entries in this
 * file plus a component — never an upstream edit.
 */
export const customPanels: PanelSpec[] = [];

/** What a custom card is handed, exactly like a built-in panel. */
export type CustomPanelProps = { payload: Payload; filters: Filters };

/** The component for each custom spec id. A missing entry renders a placeholder. */
export const customComponents: Record<string, ComponentType<CustomPanelProps>> = {};
