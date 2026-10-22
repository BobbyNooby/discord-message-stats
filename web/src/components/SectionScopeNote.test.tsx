import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { panelsIgnoring, specFor } from "../panels/registry";
import { SectionScopeNote } from "./SectionScopeNote";

describe("<SectionScopeNote>", () => {
  it("renders nothing where every card honours the time filter", () => {
    const { container } = render(<SectionScopeNote section="time" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains a section's date-less cards once, naming each one", () => {
    render(<SectionScopeNote section="people" />);
    const note = screen.getByRole("note");
    const ignoring = panelsIgnoring("people", "time");
    expect(note).toHaveTextContent(`${ignoring.length} of these 11 cards`);
    for (const id of ignoring) {
      expect(note).toHaveTextContent(specFor(id).label);
    }
    // The reason is stated once, not as a badge on every card.
    expect(note).toHaveTextContent(/no day grain/);
  });

  it("says every card when the section has no date dimension at all", () => {
    render(<SectionScopeNote section="rich-media" />);
    expect(screen.getByRole("note")).toHaveTextContent("all 2 cards here");
  });

  it("says nothing for Words, now that every word card follows the dates", () => {
    const { container } = render(<SectionScopeNote section="words" />);
    expect(container).toBeEmptyDOMElement();
  });
});
