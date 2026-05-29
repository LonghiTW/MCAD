import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-error">
        <h1>MCAD failed to render</h1>
        <pre>{this.state.error.message || String(this.state.error)}</pre>
      </main>
    );
  }
}
