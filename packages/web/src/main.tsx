import { createRoot } from 'react-dom/client';
import App from './App.js';
import RenderErrorBoundary from './components/RenderErrorBoundary/RenderErrorBoundary.js';
import './app.css';

createRoot(document.getElementById('app')!).render(
  <RenderErrorBoundary label="App shell" resetKey="app-root">
    <App />
  </RenderErrorBoundary>,
);
