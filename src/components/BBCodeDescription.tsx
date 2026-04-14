import { Component, type ReactNode } from "react";
import BBobReact from "@bbob/react";
import presetHTML5 from "@bbob/preset-html5";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Convert CSS style strings (from preset-html5) to React style objects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixStyleAttrs(nodes: any[]): void {
  for (const node of nodes) {
    if (node && typeof node === "object" && "tag" in node) {
      if (node.attrs && typeof node.attrs.style === "string") {
        const obj: Record<string, string> = {};
        for (const decl of (node.attrs.style as string).split(";")) {
          const colon = decl.indexOf(":");
          if (colon > 0) {
            const prop = decl.slice(0, colon).trim();
            const val = decl.slice(colon + 1).trim();
            if (prop && val) {
              const camel = prop.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
              obj[camel] = val;
            }
          }
        }
        node.attrs.style = obj;
      }
      if (Array.isArray(node.content)) fixStyleAttrs(node.content);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixStylePlugin = () => (tree: any) => { fixStyleAttrs(tree); return tree; };

const plugins = [presetHTML5(), fixStylePlugin()];
const bbobOptions = { onlyAllowTags: ["b", "i", "u", "s", "color", "url", "img", "code", "quote", "list", "center", "indent"] };

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
