import type { Dispatch } from "react";

import { CARD_COLUMNS, SectionHeading } from "../components/Panel";
import { SectionScopeNote } from "../components/SectionScopeNote";

import type { Payload } from "../api/types";
import type { Action, Filters } from "../filters/reducer";
import { WhoSaysIt } from "./WhoSaysIt";
import { WordCloud } from "./WordCloud";
import { WordIndex } from "./WordIndex";
import { WordLift } from "./WordLift";

/** The Words section (§11.1). The heading spans the width, outside the column flow. */
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
    <section aria-labelledby="sec-words" className="space-y-4">
      <SectionHeading id="sec-words">Words</SectionHeading>
      <SectionScopeNote section="words" />
      <div className={CARD_COLUMNS}>
        <WordLift payload={payload} filters={filters} />
        <WordIndex
          words={payload.words}
          selected={filters.word}
          onSelect={(word) => dispatch({ type: "setWord", word })}
        />
        <WhoSaysIt payload={payload} filters={filters} word={filters.word} />
        <WordCloud payload={payload} filters={filters} />
      </div>
    </section>
  );
}
