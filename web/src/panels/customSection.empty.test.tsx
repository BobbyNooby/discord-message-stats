import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { CustomSection } from "./CustomSection";

/** No mock here: this is the upstream seam, whose `custom` exports are empty. */
const payload = { authors: [], days: [], cells: [], meta: {} } as unknown as Payload;

describe("the custom section upstream", () => {
  it("renders nothing when no custom spec claims a card", () => {
    const { container } = render(
      <CustomSection payload={payload} filters={initialFilters(payload)} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
