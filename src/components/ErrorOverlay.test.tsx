import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ErrorOverlay } from "./ErrorOverlay";

afterEach(() => {
  cleanup();
});

describe("ErrorOverlay", () => {
  it("renders a summary-only message without a details toggle", () => {
    render(<ErrorOverlay message="Something went wrong" onClose={() => {}} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Error" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /show details/i })
    ).not.toBeInTheDocument();
  });

  it("shows summary and hides details by default when message contains a blank line", () => {
    render(
      <ErrorOverlay
        message={"Something went wrong\n\nStack trace line 1\nStack trace line 2"}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show details" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Stack trace line 1/)).not.toBeInTheDocument();
  });

  it("reveals details and flips button text when Show details is clicked", () => {
    render(
      <ErrorOverlay
        message={"Something went wrong\n\nStack trace line 1\nStack trace line 2"}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

    const pre = screen.getByText(/Stack trace line 1/);
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe("Stack trace line 1\nStack trace line 2");
    expect(
      screen.getByRole("button", { name: "Hide details" })
    ).toBeInTheDocument();
  });

  it("hides details again when Hide details is clicked", () => {
    render(
      <ErrorOverlay
        message={"Something went wrong\n\nDetail body"}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));

    expect(screen.queryByText("Detail body")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show details" })
    ).toBeInTheDocument();
  });

  it("calls onClose when Dismiss is clicked", () => {
    const onClose = vi.fn();
    render(<ErrorOverlay message="Boom" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
