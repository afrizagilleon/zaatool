import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Polyfill process.env for Vite compatibility with older modules
if (typeof window !== 'undefined' && !(window as any).process) {
  (window as any).process = { env: { NODE_ENV: import.meta.env.MODE } };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
