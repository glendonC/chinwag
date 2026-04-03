import { Component } from 'react';
import styles from './RenderErrorBoundary.module.css';

/**
 * Consolidated error boundary used across the app.
 *
 * Props:
 *   label    - Log label (e.g. "Sidebar", "App shell")
 *   resetKey - Auto-reset when this key changes
 *   fallback - Optional render prop: ({ reset }) => JSX. Uses default UI if omitted.
 */
export default class RenderErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    const label = this.props.label || 'Render';
    console.error(`[chinwag] ${label} error:`, error, info.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      const reset = () => this.setState({ hasError: false });
      if (this.props.fallback) return this.props.fallback({ reset });
      return (
        <div className={styles.wrapper}>
          <div className={styles.banner} role="status">
            <span className={styles.eyebrow}>Error</span>
            <span className={styles.text}>Something went wrong.</span>
            <button onClick={reset} className={styles.action}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
