import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error.message, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div
          dir="rtl"
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            fontFamily: "system-ui, sans-serif",
            background: "#f8f9fa",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "32px 28px",
              textAlign: "center",
              boxShadow: "0 2px 12px rgba(0,0,0,.08)",
            }}
          >
            <div style={{ marginBottom: 12, color: "#f59e0b" }}><AlertTriangle size={40} /></div>
            <h1
              style={{ margin: "0 0 8px", fontSize: 20, color: "#17365d" }}
            >
              حدث خطأ غير متوقع
            </h1>
            <p
              style={{
                margin: "0 0 24px",
                color: "#6b7280",
                fontSize: 14,
                lineHeight: 1.7,
              }}
            >
              {error.message}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => this.setState({ error: null })}
                style={{
                  padding: "8px 20px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                المحاولة مجدداً
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: "8px 20px",
                  borderRadius: 6,
                  border: "none",
                  background: "#17365d",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                إعادة تحميل الصفحة
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
