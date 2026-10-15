import type { Payload } from "../api/types";

/** One reducer owns every filter; charts are pure functions of (data, filters). */
export type Filters = {
  from: string | null;
  to: string | null;
  years: number[];
  active: boolean[];
  bucket: "day" | "month" | "year";
  rankBy: "msgs" | "chars" | "media" | "replies";
  word: string | null;
};

export type Action =
  | { type: "toggleAuthor"; index: number }
  | { type: "onlyAuthor"; index: number }
  | { type: "allAuthors" }
  | { type: "noAuthors" }
  | { type: "setRange"; from: string | null; to: string | null }
  | { type: "toggleYear"; year: number }
  | { type: "clearYears" }
  | { type: "setBucket"; bucket: Filters["bucket"] }
  | { type: "setRankBy"; rankBy: Filters["rankBy"] }
  | { type: "setWord"; word: string | null }
  | { type: "reset" };

/** Filters before the payload arrives: nobody is known yet, so nobody is hidden. */
export const EMPTY_FILTERS: Filters = {
  from: null,
  to: null,
  years: [],
  active: [],
  bucket: "month",
  rankBy: "msgs",
  word: null,
};

/** One author per identity, all switched on — the payload's own default view. */
export function initialFilters(payload: Payload): Filters {
  return { ...EMPTY_FILTERS, active: payload.authors.map(() => true) };
}

export function filtersReducer(state: Filters, action: Action): Filters {
  switch (action.type) {
    case "toggleAuthor": {
      const active = [...state.active];
      active[action.index] = !active[action.index];
      return { ...state, active };
    }
    case "onlyAuthor":
      return { ...state, active: state.active.map((_, i) => i === action.index) };
    case "allAuthors":
      return { ...state, active: state.active.map(() => true) };
    case "noAuthors":
      return { ...state, active: state.active.map(() => false) };
    case "setRange":
      return { ...state, from: action.from, to: action.to };
    case "toggleYear": {
      const years = state.years.includes(action.year)
        ? state.years.filter((year) => year !== action.year)
        : [...state.years, action.year].sort();
      return { ...state, years };
    }
    case "clearYears":
      return { ...state, years: [] };
    case "setBucket":
      return { ...state, bucket: action.bucket };
    case "setRankBy":
      return { ...state, rankBy: action.rankBy };
    case "setWord":
      return { ...state, word: action.word };
    case "reset":
      // `active` keeps its length: resetting shows everybody, it does not forget
      // how many people there are.
      return { ...EMPTY_FILTERS, active: state.active.map(() => true) };
    default:
      return state;
  }
}
