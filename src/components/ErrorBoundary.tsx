import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("WebADB 界面异常", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="feature-empty" style={{ minHeight: "100dvh" }}>
        <span aria-hidden="true" className="material-symbols-rounded">
          error
        </span>
        <h1>桌面遇到了一点问题</h1>
        <p>重新加载页面可恢复连接，桌面偏好会保留。</p>
        <button onClick={() => window.location.reload()} type="button">
          重新加载
        </button>
      </main>
    );
  }
}
