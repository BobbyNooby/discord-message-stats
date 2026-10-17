import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Banner } from "./Banner";
import { Chip } from "./Chip";
import { Dialog } from "./Dialog";
import { IconButton } from "./IconButton";
import { Menu } from "./Menu";
import { Sheet } from "./Sheet";
import { Toggle } from "./Toggle";

describe("<Sheet> and <Dialog>", () => {
  it("labels scrim and close differently, so both are reachable by name", () => {
    render(
      <Sheet open onOpenChange={() => {}} title="Filters">
        <p>body</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1);
    // The scrim dismisses, but it carries no accessible name of its own: two
    // controls with one name is what broke a real click before.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the scrim out of the tab order and hidden from the a11y tree", () => {
    render(
      <Dialog open onOpenChange={() => {}} title="Top 50">
        <p>body</p>
      </Dialog>,
    );
    const scrim = screen.getByTestId("scrim");
    expect(scrim).toHaveAttribute("aria-hidden", "true");
    expect(scrim).toHaveAttribute("tabindex", "-1");
  });

  it("closes on Escape", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Top 50">
        <p>body</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders its footer inside the labelled dialog", () => {
    render(
      <Dialog open onOpenChange={() => {}} title="Top 50" footer={<button type="button">Copy</button>}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Top 50" })).toContainElement(
      screen.getByRole("button", { name: "Copy" }),
    );
  });
});

describe("<Toggle>", () => {
  it("reports pressed state on the toggle", async () => {
    const onChange = vi.fn();
    render(
      <Toggle pressed={false} onPressedChange={onChange} icons={[<span key="a">A</span>]} labels={["Bars"]} />,
    );
    await userEvent.click(screen.getByRole("button", { pressed: false }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("names itself from the label of the state it is in", () => {
    render(
      <Toggle
        pressed
        onPressedChange={() => {}}
        icons={[<span key="a">A</span>, <span key="b">B</span>]}
        labels={["Bars", "Polar rose"]}
      />,
    );
    expect(screen.getByRole("button", { name: "Polar rose", pressed: true })).toBeInTheDocument();
  });
});

describe("<Menu>", () => {
  it("opens from its own labelled trigger and reports the chosen item", async () => {
    const onSelect = vi.fn();
    render(
      <Menu
        trigger={<IconButton label="More actions for Messages over time" icon={<span>…</span>} />}
        items={[
          { label: "Copy view link", onSelect },
          { label: "Reset this card", onSelect: vi.fn(), destructive: true },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More actions for Messages over time" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy view link" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("<Chip>", () => {
  it("removes itself through one uniquely named control", async () => {
    const onRemove = vi.fn();
    render(<Chip label="1 of 2 authors" onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove 1 of 2 authors" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders without a remove control when it is not removable", () => {
    render(<Chip label="all time" />);
    expect(screen.getByText("all time")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("<IconButton>", () => {
  it("is reachable by its accessible name", async () => {
    const onClick = vi.fn();
    render(<IconButton label="Close" icon={<span>x</span>} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("<Banner>", () => {
  it("announces itself and carries one action", async () => {
    const onApply = vi.fn();
    render(
      <Banner tone="info" action={<button type="button" onClick={onApply}>Apply</button>}>
        Filter for Who talks the most
      </Banner>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Filter for Who talks the most");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
