import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/** Regex for LaTeX command patterns (no $ delimiters needed). */
const RAW_LATEX_RE = /\\(?:frac|alpha|beta|gamma|delta|rho|sigma|theta|lambda|omega|mu|nu|pi|phi|psi|epsilon|Delta|Sigma|Omega|Lambda|Phi|Psi|left|right|times|cdot|sqrt|sum|prod|int|infty|partial|nabla|mathrm|mathbf|displaystyle|begin|end|text|quad|qquad|hspace|vspace|overline|underline|hat|bar|vec|dot|tilde|operatorname)[^a-zA-Z]|[_^]\{/;

/** Returns true if text contains LaTeX — either $-delimited or raw LaTeX commands. */
export function containsLatex(text: string | null | undefined): boolean {
  if (!text) return false;
  // Check for $ delimiters first (fast path)
  if (/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(text)) return true;
  // Check for raw LaTeX command patterns
  return RAW_LATEX_RE.test(text);
}

/**
 * Renders text that may contain LaTeX equations.
 * Supports $$...$$ (display), $...$ (inline), and raw LaTeX without delimiters.
 */
export function LatexText({
  children,
  style,
  className,
}: {
  children: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const html = useMemo(() => {
    if (!children) return "";

    // Split on $$...$$ (display) and $...$ (inline), capturing delimiters
    const parts = children.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);

    const hasDelimitedLatex = parts.some(
      (p) => (p.startsWith("$$") && p.endsWith("$$")) || (p.startsWith("$") && p.endsWith("$") && p.length > 2),
    );

    // If no $-delimited LaTeX found, check if entire string is raw LaTeX
    if (!hasDelimitedLatex && RAW_LATEX_RE.test(children)) {
      try {
        return katex.renderToString(children.trim(), {
          throwOnError: false,
          displayMode: true,
          trust: true,
        });
      } catch {
        return `<code style="font-size:0.9em;color:var(--color-text-secondary)">${escapeHtml(children)}</code>`;
      }
    }

    return parts
      .map((part) => {
        if (part.startsWith("$$") && part.endsWith("$$")) {
          const latex = part.slice(2, -2).trim();
          try {
            return katex.renderToString(latex, {
              throwOnError: false,
              displayMode: true,
              trust: true,
            });
          } catch {
            return `<code style="font-size:0.9em;color:var(--color-text-secondary)">${escapeHtml(latex)}</code>`;
          }
        }
        if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
          const latex = part.slice(1, -1).trim();
          try {
            return katex.renderToString(latex, {
              throwOnError: false,
              displayMode: false,
              trust: true,
            });
          } catch {
            return `<code style="font-size:0.9em;color:var(--color-text-secondary)">${escapeHtml(latex)}</code>`;
          }
        }
        return escapeHtml(part);
      })
      .join("");
  }, [children]);

  return (
    <span
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
