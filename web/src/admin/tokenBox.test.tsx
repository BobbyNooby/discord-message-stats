import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TokenBox } from "./TokenBox";

const api = vi.hoisted(() => ({
  getTokenCheck: vi.fn(),
  saveToken: vi.fn(),
  forgetToken: vi.fn(),
}));

vi.mock("./api", () => api);

function renderBox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TokenBox />
    </QueryClientProvider>,
  );
}

describe("<TokenBox>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getTokenCheck.mockResolvedValue({ status: "unknown", source: "environment" });
  });

  it("saves a token, says who it is, and never keeps the value in the page", async () => {
    const user = userEvent.setup();
    api.saveToken.mockResolvedValue({
      ok: true,
      bot: { id: "1", username: "alt", global_name: "Alt Account" },
      channel: { ok: true, id: "c1", name: "general", error: null },
    });
    renderBox();
    expect(await screen.findByText(/from DISCORD_TOKEN in the environment/)).toBeInTheDocument();
    const field = screen.getByLabelText("New token");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "abc.def");
    await user.click(screen.getByRole("button", { name: "Check & save" }));
    expect(api.saveToken).toHaveBeenCalledWith("abc.def");
    expect(await screen.findByText(/signs in as Alt Account and can read #general/)).toBeInTheDocument();
    expect(field).toHaveValue("");
  });

  it("shows Discord's refusal and still clears the field", async () => {
    const user = userEvent.setup();
    api.saveToken.mockRejectedValue(new Error("Discord rejected that token — nothing was saved"));
    renderBox();
    const field = screen.getByLabelText("New token");
    await user.type(field, "typo");
    await user.click(screen.getByRole("button", { name: "Check & save" }));
    expect(await screen.findByText(/nothing was saved/)).toBeInTheDocument();
    expect(field).toHaveValue("");
  });

  it("offers to forget a token only when one was saved here", async () => {
    const user = userEvent.setup();
    api.getTokenCheck.mockResolvedValue({ status: "ok", source: "saved" });
    api.forgetToken.mockResolvedValue(undefined);
    renderBox();
    await user.click(await screen.findByRole("button", { name: "Forget saved token" }));
    expect(api.forgetToken).toHaveBeenCalledTimes(1);
  });
});
