import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SuccessOverlay } from "./SuccessOverlay";

afterEach(() => {
  cleanup();
});

describe("SuccessOverlay", () => {
  it("renders the message and Success heading", () => {
    render(
      <SuccessOverlay
        message="Addon installed"
        details={null}
        onClose={() => {}}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Success" })
    ).toBeInTheDocument();
    expect(screen.getByText("Addon installed")).toBeInTheDocument();
  });

  it("does not show a details toggle when details is null", () => {
    render(
      <SuccessOverlay
        message="Addon installed"
        details={null}
        onClose={() => {}}
      />
    );

    expect(
      screen.queryByRole("button", { name: /show details/i })
    ).not.toBeInTheDocument();
  });

  it("shows a details toggle and hides details by default when details is provided", () => {
    render(
      <SuccessOverlay
        message="Addon installed"
        details="Auto-installed: LibAddonMenu-2.0"
        onClose={() => {}}
      />
    );

    expect(
      screen.getByRole("button", { name: "Show details" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Auto-installed: LibAddonMenu-2.0")
    ).not.toBeInTheDocument();
  });

  it("reveals and hides details when the toggle is clicked", () => {
    render(
      <SuccessOverlay
        message="Addon installed"
        details="Auto-installed: LibAddonMenu-2.0"
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(
      screen.getByText("Auto-installed: LibAddonMenu-2.0")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide details" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(
      screen.queryByText("Auto-installed: LibAddonMenu-2.0")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show details" })
    ).toBeInTheDocument();
  });

  it("calls onClose when Dismiss is clicked", () => {
    const onClose = vi.fn();
    render(
      <SuccessOverlay message="Done" details={null} onClose={onClose} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
