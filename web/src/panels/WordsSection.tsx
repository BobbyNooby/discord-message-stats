import type { Dispatch } from "react";

import type { Payload } from "../api/types";
import type { Action, Filters } from "../filters/reducer";
import { WhoSaysIt } from "./WhoSaysIt";
import { WordCloud } from "./WordCloud";
import { WordIndex } from "./WordIndex";
import { WordLift } from "./WordLift";

/** The Words section (§11.1) with the mockup's 3-column rhythm: w3, w2, 1, w3. */
export function WordsSection({
  payload,
  filters,
  dispatch,
}: {
  payload: Payload;
  filters: Filters;
  dispatch: Dispatch<Action>;
}) {
  return (
    <section aria-labelledby="sec-words" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <h2 id="sec-words" className="text-base font-semibold text-[var(--color-text)] lg:col-span-2 xl:col-span-3">
        Words
      </h2>
      <div className="lg:col-span-2 xl:col-span-3">
        <WordLift payload={payload} filters={filters} />
      </div>
      <div className="lg:col-span-1 xl:col-span-2">
        <WordIndex
          words={payload.words}
          selected={filters.word}
          onSelect={(word) => dispatch({ type: "setWord", word })}
        />
      </div>
      <div>
        <WhoSaysIt payload={payload} filters={filters} word={filters.word} />
      </div>
      <div className="lg:col-span-2 xl:col-span-3">
        <WordCloud payload={payload} filters={filters} />
      </div>
    </section>
  );
}
