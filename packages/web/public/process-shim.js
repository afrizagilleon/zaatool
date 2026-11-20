// Some bundled libraries read `process.env.NODE_ENV` at load. This used to be an inline
// <script> in index.html; the app's Content-Security-Policy allows no inline script, so it is
// a file served from the same origin instead. Loaded before the bundle, so it still runs first.
window.process = { env: { NODE_ENV: 'development' } };
