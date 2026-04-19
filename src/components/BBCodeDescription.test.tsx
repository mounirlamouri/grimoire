import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BBCodeDescription } from "./BBCodeDescription";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Reset scrollHeight/clientHeight overrides
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: function () { return 0; },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: function () { return 0; },
  });
});

// ---- Basic BBCode rendering ----

describe("BBCodeDescription plain text", () => {
  it("renders plain text without BBCode", () => {
    render(<BBCodeDescription text="Hello, world!" />);
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
  });

  it("renders an empty string without crashing", () => {
    const { container } = render(<BBCodeDescription text="" />);
    expect(container).toBeTruthy();
  });

  it("renders a whitespace-only string without crashing", () => {
    const { container } = render(<BBCodeDescription text="   " />);
    expect(container).toBeTruthy();
  });
});

describe("BBCodeDescription bold", () => {
  it("renders [b]text[/b] with bold styling", () => {
    const { container } = render(<BBCodeDescription text="[b]bold text[/b]" />);
    expect(screen.getByText("bold text")).toBeInTheDocument();
    // bbob preset-react renders [b] as <span style="font-weight: bold">
    expect(container.innerHTML).toMatch(/font-weight:\s*bold/i);
  });
});

describe("BBCodeDescription url", () => {
  it("renders [url=href]text[/url] as an anchor", () => {
    const { container } = render(
      <BBCodeDescription text="[url=https://example.com]Click here[/url]" />
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toBe("Click here");
    expect(anchor!.getAttribute("href")).toBe("https://example.com");
  });
});

describe("BBCodeDescription link click scheme validation", () => {
  it("does not call openUrl for javascript: scheme", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const mockOpen = openUrl as ReturnType<typeof vi.fn>;
    mockOpen.mockClear();
    const { container } = render(
      <BBCodeDescription text="[url=javascript:alert(1)]x[/url]" />
    );
    const anchor = container.querySelector("a")!;
    fireEvent.click(anchor);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("calls openUrl for https: scheme", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const mockOpen = openUrl as ReturnType<typeof vi.fn>;
    mockOpen.mockClear();
    const { container } = render(
      <BBCodeDescription text="[url=https://example.com]x[/url]" />
    );
    const anchor = container.querySelector("a")!;
    fireEvent.click(anchor);
    expect(mockOpen).toHaveBeenCalledWith("https://example.com/");
  });
});

describe("BBCodeDescription spoiler", () => {
  it("renders [spoiler]text[/spoiler] as <details> with default summary", () => {
    const { container } = render(<BBCodeDescription text="[spoiler]secret[/spoiler]" />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    const summary = details!.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toBe("Spoiler");
    expect(details!.textContent).toContain("secret");
  });

  it("renders [spoiler=Title]text[/spoiler] with custom summary title", () => {
    const { container } = render(
      <BBCodeDescription text="[spoiler=My Title]hidden content[/spoiler]" />
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    const summary = details!.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toBe("My Title");
    expect(details!.textContent).toContain("hidden content");
  });
});

describe("BBCodeDescription youtube", () => {
  it("renders [youtube]VIDEO_ID[/youtube] as a link to youtube.com/watch?v=VIDEO_ID", () => {
    const { container } = render(<BBCodeDescription text="[youtube]dQw4w9WgXcQ[/youtube]" />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(anchor!.textContent).toContain("YouTube");
  });

  it("renders [youtube] with full youtube URL and extracts video ID", () => {
    const { container } = render(
      <BBCodeDescription text="[youtube]https://www.youtube.com/watch?v=dQw4w9WgXcQ[/youtube]" />
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
  });

  it("renders [youtube] with short youtu.be URL and extracts video ID", () => {
    const { container } = render(
      <BBCodeDescription text="[youtube]https://youtu.be/dQw4w9WgXcQ[/youtube]" />
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
  });

  it("renders [youtube] with YouTube Shorts URL and extracts video ID", () => {
    const { container } = render(
      <BBCodeDescription text="[youtube]https://www.youtube.com/shorts/dQw4w9WgXcQ[/youtube]" />
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
  });

  it("applies .youtube-link class for styling", () => {
    const { container } = render(<BBCodeDescription text="[youtube]dQw4w9WgXcQ[/youtube]" />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.classList.contains("youtube-link")).toBe(true);
  });
});

describe("BBCodeDescription size", () => {
  it("renders [size=1]text[/size] with fontSize 0.75em", () => {
    const { container } = render(<BBCodeDescription text="[size=1]small[/size]" />);
    expect(screen.getByText("small")).toBeInTheDocument();
    expect(container.innerHTML).toMatch(/font-size:\s*0\.75em/i);
  });

  it("renders [size=7]text[/size] with fontSize 1.5em", () => {
    const { container } = render(<BBCodeDescription text="[size=7]large[/size]" />);
    expect(screen.getByText("large")).toBeInTheDocument();
    expect(container.innerHTML).toMatch(/font-size:\s*1\.5em/i);
  });

  it("clamps [size=999] to 1.5em", () => {
    const { container } = render(<BBCodeDescription text="[size=999]huge[/size]" />);
    expect(screen.getByText("huge")).toBeInTheDocument();
    expect(container.innerHTML).toMatch(/font-size:\s*1\.5(0)?em/i);
  });
});

describe("BBCodeDescription font", () => {
  it("strips [font=Arial]text[/font] — content renders without font-family", () => {
    const { container } = render(
      <BBCodeDescription text="[font=Arial]hello[/font]" />
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
    // The implementation replaces [font] with a <span> and empties its attrs,
    // so no font-family style should leak through.
    expect(container.innerHTML).not.toMatch(/font-family/i);
    expect(container.innerHTML).not.toMatch(/Arial/);
  });
});

describe("BBCodeDescription indent", () => {
  it("renders [indent=2]text[/indent] with paddingLeft 3em", () => {
    const { container } = render(<BBCodeDescription text="[indent=2]indented[/indent]" />);
    // The indent tag becomes a <div>
    const div = container.querySelector(".bbcode-description div");
    expect(div).not.toBeNull();
    expect((div as HTMLElement).style.paddingLeft).toBe("3em");
  });
});

// ---- Tag-name normalization (ESOUI uses uppercase) ----

describe("BBCodeDescription uppercase tag normalization", () => {
  it("renders [B]text[/B] as bold (uppercase tag)", () => {
    const { container } = render(<BBCodeDescription text="[B]bold text[/B]" />);
    expect(screen.getByText("bold text")).toBeInTheDocument();
    expect(container.innerHTML).toMatch(/font-weight:\s*bold/i);
  });

  it("renders [URL=href]text[/URL] as an anchor (uppercase tag)", () => {
    const { container } = render(
      <BBCodeDescription text="[URL=https://example.com]Click[/URL]" />
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("https://example.com");
    expect(anchor!.textContent).toBe("Click");
  });

  it("renders mixed-case [List][*]item[/List] as <ul>/<li>", () => {
    const { container } = render(
      <BBCodeDescription text="[List][*]first[*]second[/List]" />
    );
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    const lis = ul!.querySelectorAll("li");
    expect(lis).toHaveLength(2);
    expect(lis[0].textContent).toContain("first");
    expect(lis[1].textContent).toContain("second");
  });
});

// ---- List rendering ----

describe("BBCodeDescription list rendering", () => {
  it("renders [list][*]one[*]two[/list] as <ul> with two <li> children", () => {
    const { container } = render(
      <BBCodeDescription text="[list][*]one[*]two[/list]" />
    );
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    const lis = ul!.querySelectorAll("li");
    expect(lis).toHaveLength(2);
    expect(lis[0].textContent).toContain("one");
    expect(lis[1].textContent).toContain("two");
  });

  it("does not render stray <br> nodes inside lists", () => {
    const { container } = render(
      <BBCodeDescription text="[list]\n[*]one\n[*]two\n[/list]" />
    );
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul!.querySelector("br")).toBeNull();
  });
});

// ---- Line-break handling ----

describe("BBCodeDescription line breaks", () => {
  it("converts bare \\n to a <br> element", () => {
    const { container } = render(<BBCodeDescription text={"line1\nline2"} />);
    const brs = container.querySelectorAll(".bbcode-description br");
    expect(brs.length).toBe(1);
    expect(container.textContent).toContain("line1");
    expect(container.textContent).toContain("line2");
  });

  it("strips \\r from CRLF so \\r\\n produces exactly one <br>", () => {
    const { container } = render(<BBCodeDescription text={"line1\r\nline2"} />);
    const brs = container.querySelectorAll(".bbcode-description br");
    expect(brs.length).toBe(1);
    // \r should not leak into the rendered text
    expect(container.textContent).not.toMatch(/\r/);
  });

  it("does not insert <br> before a block-level element like <ul>", () => {
    const { container } = render(
      <BBCodeDescription text={"intro\n[list][*]item[/list]"} />
    );
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    // The node immediately before the <ul> must not be a <br>
    const prev = ul!.previousElementSibling;
    expect(prev?.tagName).not.toBe("BR");
  });

  it("does not insert <br> after a block-level element like <ul>", () => {
    const { container } = render(
      <BBCodeDescription text={"[list][*]item[/list]\nafter"} />
    );
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    const next = ul!.nextElementSibling;
    expect(next?.tagName).not.toBe("BR");
  });
});

// ---- Truncation ----

describe("BBCodeDescription truncation", () => {
  beforeEach(() => {
    // Simulate a tall container (content taller than visible area)
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 100,
    });
  });

  it("shows 'Show full description' button when content is taller than container", async () => {
    render(<BBCodeDescription text={"Line\n".repeat(40)} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show full description" })).toBeInTheDocument();
    });
  });

  it("opens modal when 'Show full description' is clicked", async () => {
    render(<BBCodeDescription text={"Line\n".repeat(40)} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show full description" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Show full description" }));
    expect(screen.getByText("Description")).toBeInTheDocument();
  });

  it("closes modal when ✕ button is clicked", async () => {
    render(<BBCodeDescription text={"Line\n".repeat(40)} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show full description" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Show full description" }));
    expect(screen.getByText("Description")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    await waitFor(() => {
      expect(screen.queryByText("Description")).not.toBeInTheDocument();
    });
  });

  it("closes modal when backdrop is clicked", async () => {
    render(<BBCodeDescription text={"Line\n".repeat(40)} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show full description" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Show full description" }));
    expect(screen.getByText("Description")).toBeInTheDocument();
    // The backdrop is the fixed overlay div — find it via the portal on document.body
    const backdrop = document.body.querySelector(".fixed.inset-0") as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    await waitFor(() => {
      expect(screen.queryByText("Description")).not.toBeInTheDocument();
    });
  });

  it("closes modal when Escape key is pressed", async () => {
    render(<BBCodeDescription text={"Line\n".repeat(40)} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show full description" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Show full description" }));
    expect(screen.getByText("Description")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Description")).not.toBeInTheDocument();
    });
  });

  it("returns focus to 'Show full description' button after modal closes via ✕", async () => {
    render(<BBCodeDescription text={"Line\n".repeat(40)} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show full description" })).toBeInTheDocument();
    });
    const showBtn = screen.getByRole("button", { name: "Show full description" });
    fireEvent.click(showBtn);
    expect(screen.getByText("Description")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    await waitFor(() => {
      expect(screen.queryByText("Description")).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(showBtn);
  });
});

describe("BBCodeDescription no truncation button when content fits", () => {
  beforeEach(() => {
    // Simulate container where content fits (scrollHeight <= clientHeight + 2)
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 100,
    });
  });

  it("does not show 'Show full description' button when content fits", async () => {
    render(<BBCodeDescription text="Short text." />);
    // Wait a tick for the useEffect to fire
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Show full description" })
      ).not.toBeInTheDocument();
    });
  });
});

