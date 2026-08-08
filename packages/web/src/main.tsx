import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

declare global {
  interface Window {
    process?: { env: Record<string, string> };
  }
}

// Polyfill process.env for Vite compatibility with older modules
if (typeof window !== 'undefined' && !window.process) {
  window.process = { env: { NODE_ENV: import.meta.env.MODE } };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
