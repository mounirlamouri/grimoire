import { Component, useState, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BBobReact from "@bbob/react";
import presetReact from "@bbob/preset-react";
import { openUrl } from "@tauri-apps/plugin-opener";

// Map BBCode [size=N] (1–7 scale) to clamped em values (0.75–1.5)
const SIZE_MAP: Record<string, string> = {
  "1": "0.75em", "2": "0.85em", "3": "1em", "4": "1.1em",
  "5": "1.2em", "6": "1.35em", "7": "1.5em",
};

function clampFontSize(raw: string): string {
  if (SIZE_MAP[raw]) return SIZE_MAP[raw];
  const n = parseFloat(raw);
  if (isNaN(n)) return "1em";
  if (n >= 1 && n <= 7) return SIZE_MAP[String(Math.round(n))] || "1em";
  const em = Math.min(1.5, Math.max(0.75, n / 14));
  return `${em.toFixed(2)}em`;
}

const BLOCK_TAGS = new Set(["ul", "ol", "blockquote", "pre"]);

/** Normalize tag names to lowercase and strip \r from strings so the preset matches correctly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeNodes(nodes: any[]): void {
  for (let i = 0; i < nodes.length; i++) {
    if (typeof nodes[i] === "string") {
      nodes[i] = nodes[i].replace(/\r/g, "");
    } else if (nodes[i] && typeof nodes[i] === "object" && "tag" in nodes[i]) {
      nodes[i].tag = nodes[i].tag.toLowerCase();
      if (Array.isArray(nodes[i].content)) normalizeNodes(nodes[i].content);
    }
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizePlugin = () => (tree: any) => { normalizeNodes(tree); return tree; };

/** Split string nodes on \n, inserting <br> tag nodes to preserve line breaks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function splitNewlines(nodes: any[]): any[] {
  const result: any[] = [];
  for (const node of nodes) {
    if (typeof node === "string" && node.includes("\n")) {
      const parts = node.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) result.push(parts[i]);
        if (i < parts.length - 1) result.push({ tag: "br", attrs: {}, content: [] });
      }
    } else {
      result.push(node);
    }
  }
  // Remove <br> nodes immediately before or after block-level elements
  return result.filter((node, i) => {
    if (node?.tag !== "br") return true;
    const prev = result[i - 1];
    const next = result[i + 1];
    return !(
      (prev && BLOCK_TAGS.has(prev?.tag)) ||
      (next && BLOCK_TAGS.has(next?.tag))
    );
  });
}

/** Fix nodes: handle [*], [size], [font] tags, clamp font sizes, preserve newlines. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixNodes(nodes: any[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node && typeof node === "object" && "tag" in node) {
      // Convert [*] to <li> (preset misses these when content is split across siblings)
      if (node.tag === "*") {
        node.tag = "li";
      }
      // Strip [font] tags — keep content, discard the font
      if (node.tag === "font") {
        node.tag = "span";
        node.attrs = {};
      }
      // Convert [size=N] to a span with clamped font-size
      if (node.tag === "size") {
        const sizeVal = node.attrs?.[node.tag] || Object.keys(node.attrs || {})[0] || "3";
        node.tag = "span";
        node.attrs = { style: { fontSize: clampFontSize(String(sizeVal)) } };
      } else if (node.tag === "indent") {
        // Convert [indent] to a div with padding
        const level = parseFloat(String(Object.keys(node.attrs || {})[0] || "1")) || 1;
        node.tag = "div";
        node.attrs = { style: { paddingLeft: `${Math.min(level, 6) * 1.5}em` } };
      } else if (node.tag === "spoiler") {
        // Convert [spoiler] / [spoiler=Title] to <details><summary>
        const title = Object.keys(node.attrs || {})[0] || "Spoiler";
        node.tag = "details";
        node.attrs = {};
        node.content = [{ tag: "summary", attrs: {}, content: [title] }, ...(node.content || [])];
      } else if (node.tag === "youtube") {
        // Convert [youtube]ID_OR_URL[/youtube] to a clickable link
        const raw = (node.content || []).filter((c: any) => typeof c === "string").join("").trim();
        const idMatch = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
        const videoId = idMatch ? idMatch[1] : raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11);
        const href = `https://www.youtube.com/watch?v=${videoId}`;
        node.tag = "a";
        node.attrs = { href, className: "youtube-link" };
        node.content = ["▶ Watch on YouTube"];
      } else if (node.attrs?.style && typeof node.attrs.style === "object" && node.attrs.style.fontSize) {
        // Clamp fontSize in style objects from preset-react (must be else-if to avoid
        // re-clamping a fontSize we just set above, which would corrupt the value)
        node.attrs.style.fontSize = clampFontSize(node.attrs.style.fontSize);
      }
      if (Array.isArray(node.content)) {
        if (node.tag === "ul" || node.tag === "ol" || node.tag === "li") {
          // Strip whitespace-only text nodes inside lists — <li> handles spacing
          node.content = node.content.filter(
            (c: any) => !(typeof c === "string" && !c.trim())
          );
        } else {
          node.content = splitNewlines(node.content);
        }
        fixNodes(node.content);
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixNodesPlugin = () => (tree: any) => {
  const expanded = splitNewlines(tree);
  tree.length = 0;
  tree.push(...expanded);
  fixNodes(tree);
  return tree;
};

const plugins = [normalizePlugin(), presetReact(), fixNodesPlugin()];
const bbobOptions = { onlyAllowTags: ["b", "i", "u", "s", "size", "font", "color", "url", "img", "code", "quote", "list", "*", "center", "indent", "spoiler", "youtube"] };

class BBCodeErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) { console.error("[BBCode render error]", error); }
  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

function linkClickHandler(e: React.MouseEvent) {
  const anchor = (e.target as HTMLElement).closest("a");
  if (anchor?.href) {
    e.preventDefault();
    openUrl(anchor.href).catch(() => {});
  }
}

function DescriptionModal({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-[var(--teal-dim)]/40 bg-[var(--bg-secondary)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--accent)]">Description</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] leading-none"
          >
            ✕
          </button>
        </div>
        <div
          className="bbcode-description text-[var(--text-secondary)] leading-relaxed space-y-2"
          onClick={linkClickHandler}
        >
          <BBobReact plugins={plugins} options={bbobOptions}>{text}</BBobReact>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Renders a BBCode description string, truncated to 12 lines.
 * Shows a "Show more" button if truncated, opening a modal with the full text.
 */
export function BBCodeDescription({ text }: { text: string }) {
  const [isTruncated, setIsTruncated] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const showMoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) setIsTruncated(el.scrollHeight > el.clientHeight + 2);
  }, [text]);

  const handleClose = () => {
    setModalOpen(false);
    showMoreRef.current?.focus();
  };

  const fallback = (
    <p className="text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{text}</p>
  );

  return (
    <BBCodeErrorBoundary fallback={fallback}>
      <div>
        <div className="relative">
          <div
            ref={containerRef}
            className="bbcode-description text-[var(--text-secondary)] leading-relaxed space-y-2 overflow-hidden"
            style={{ maxHeight: "19.5em" }}
            onClick={linkClickHandler}
          >
            <BBobReact plugins={plugins} options={bbobOptions}>{text}</BBobReact>
          </div>
          {isTruncated && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16"
              style={{ background: "linear-gradient(to bottom, transparent, var(--bg-card))" }}
            />
          )}
        </div>
        {isTruncated && (
          <button
            ref={showMoreRef}
            onClick={() => setModalOpen(true)}
            className="mt-1 cursor-pointer text-xs text-[var(--teal)] hover:underline"
          >
            Show full description
          </button>
        )}
        {modalOpen && <DescriptionModal text={text} onClose={handleClose} />}
      </div>
    </BBCodeErrorBoundary>
  );
}
