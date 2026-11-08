import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/** Spec §8: one error boundary per panel, so one broken panel doesn't take down the room. */
export class PanelBoundary extends Component<{ title: string; children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.title} panel crashed`, error, info.componentStack);
  }

  override render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="m-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {this.props.title} failed to load.{' '}
          <button type="button" className="underline" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
