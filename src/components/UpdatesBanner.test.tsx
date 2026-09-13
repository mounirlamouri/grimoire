import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UpdatesBanner } from "./UpdatesBanner";
import type { AddonUpdate } from "../types/addon";

afterEach(() => {
  cleanup();
});

const updates: AddonUpdate[] = [
  { dir_name: "Alpha", title: "Alpha", installed_version: "1.0", latest_version: "1.1", uid: "1", download_url: null },
  { dir_name: "Beta", title: "Beta", installed_version: "2.0", latest_version: "2.1", uid: "2", download_url: null },
];

describe("UpdatesBanner", () => {
  it("renders nothing when there are no updates", () => {
    const { container } = render(<UpdatesBanner updates={[]} onUpdateAll={() => {}} updatingAll={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists updates and calls onUpdateAll once when clicked", () => {
    const onUpdateAll = vi.fn();
    render(<UpdatesBanner updates={updates} onUpdateAll={onUpdateAll} updatingAll={false} />);

    expect(screen.getByText("Updates Available (2)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update All" }));

    expect(onUpdateAll).toHaveBeenCalledTimes(1);
  });

  it("disables the button while a batch update is running", () => {
    render(<UpdatesBanner updates={updates} onUpdateAll={() => {}} updatingAll={true} />);

    expect(screen.getByRole("button", { name: "Updating..." })).toBeDisabled();
  });
});
