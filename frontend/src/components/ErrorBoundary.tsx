import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100vh", padding: 32, gap: 16,
          background: "var(--color-bg-base, #f8fafc)",
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary, #0f172a)" }}>
            Something went wrong
          </div>
          <div style={{
            maxWidth: 500, padding: 14, borderRadius: 8,
            background: "rgba(254,242,242,0.9)", border: "1px solid rgba(220,38,38,0.2)",
            fontSize: 12.5, lineHeight: 1.7, color: "#991b1b",
            wordBreak: "break-word", fontFamily: "monospace",
          }}>
            {this.state.error?.message ?? "Unknown error"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              height: 36, padding: "0 20px", borderRadius: 8,
              border: "none", background: "var(--color-accent, #2563eb)",
              color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
