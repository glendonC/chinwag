import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './RenderErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  label?: string;
  resetKey?: string | number;
  fallback?: (opts: { reset: () => void }) => ReactNode;
}

interface State {
  hasError: boolean;
}

export default class RenderErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const label = this.props.label || 'Render';
    console.error(`[chinmeister] ${label} error:`, error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const reset = () => this.setState({ hasError: false });
      if (this.props.fallback) return this.props.fallback({ reset });
      return (
        <div className={styles.wrapper} role="status">
          <p className={styles.title}>Something went wrong.</p>
          <p className={styles.hint}>This section failed to render.</p>
          <button onClick={reset} className={styles.action}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
