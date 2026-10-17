import { createContext, useContext } from "react";

import type { CsvRow } from "../lib/csv";

/**
 * How a chart hands the rows it drew back to the card that frames it.
 *
 * The card owns the export control, so it also owns the filename and the
 * notice; the chart only knows the numbers. One context, so no panel has to
 * thread a `csv` prop through and none can forget to.
 */
export type RegisterPanelCsv = (rows: CsvRow[]) => void;

export const PanelCsvContext = createContext<RegisterPanelCsv | null>(null);

/** Outside a card this is a no-op, so `<EChart>` needs no harness in a test. */
export function usePanelCsv(): RegisterPanelCsv {
  return useContext(PanelCsvContext) ?? noop;
}

function noop(): void {
  /* a chart outside a card has nobody to tell */
}
