import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UpdateProgressModal } from "./UpdateProgressModal";

afterEach(() => {
  cleanup();
});

describe("UpdateProgressModal", () => {
  it("shows the addon in flight and its position in the batch", () => {
    render(<UpdateProgressModal completed={0} total={23} title="Combat Metrics" />);

    expect(screen.getByRole("heading", { name: "Updating Addons" })).toBeInTheDocument();
    expect(screen.getByText("Updating Combat Metrics...")).toBeInTheDocument();
    expect(screen.getByText("1 / 23")).toBeInTheDocument();
  });

  it("fills the progress bar based on completed addons", () => {
    render(<UpdateProgressModal completed={5} total={10} title="Alpha" />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "5");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect((bar.firstChild as HTMLElement).style.width).toBe("50%");
    expect(screen.getByText("6 / 10")).toBeInTheDocument();
  });
});
