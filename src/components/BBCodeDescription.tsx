import { Component, type ReactNode } from "react";
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

/** Fix nodes: handle [size], [font], and [list] tags, clamp font sizes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixNodes(nodes: any[]): void {
  for (const node of nodes) {
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
      }
      // Clamp fontSize in style objects from preset-react
      if (node.attrs?.style && typeof node.attrs.style === "object" && node.attrs.style.fontSize) {
        node.attrs.style.fontSize = clampFontSize(node.attrs.style.fontSize);
      }
      if (Array.isArray(node.content)) fixNodes(node.content);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixNodesPlugin = () => (tree: any) => { fixNodes(tree); return tree; };

const plugins = [presetReact(), fixNodesPlugin()];
const bbobOptions = { onlyAllowTags: ["b", "i", "u", "s", "size", "font", "color", "url", "img", "code", "quote", "list", "*", "center", "indent"] };

class BBCodeErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) { console.error("[BBCode render error]", error); }
  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

/**
 * Renders a BBCode description string as React elements.
 * Links open in the external browser via Tauri's opener plugin.
 */
export function BBCodeDescription({ text }: { text: string }) {
  const fallback = (
    <p className="text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{text}</p>
  );
  return (
    <BBCodeErrorBoundary fallback={fallback}>
      <div
        className="bbcode-description text-[var(--text-secondary)] leading-relaxed space-y-2 overflow-hidden"
        onClick={(e) => {
          // Intercept link clicks to open in external browser
          const target = e.target as HTMLElement;
          const anchor = target.closest("a");
          if (anchor?.href) {
            e.preventDefault();
            e.stopPropagation();
            openUrl(anchor.href).catch(() => {});
          }
        }}
      >
        <BBobReact plugins={plugins} options={bbobOptions}>
          {text}
        </BBobReact>
      </div>
    </BBCodeErrorBoundary>
  );
}
