/**
 * Where the API lives.
 *
 * By default the app talks to `/api` on its own origin: the dev server proxies it, and in
 * production one Node process serves both. When the frontend is hosted on its own (for
 * example on Vercel), set `VITE_API_URL` at build time to the server's address, such as
 * `https://lingua-bridge-api.onrender.com`, and list the frontend's origin in the server's
 * `CORS_ORIGIN`.
 */
const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '');

export const API_BASE = configured ?? '';

/** True when the frontend was built to use a server on another origin. */
export const usesSeparateApi = Boolean(configured);

/** Absolute or same-origin URL for an API path such as `/api/health`. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** WebSocket URL for an API path, following the API's own scheme and host. */
export function socketUrl(path: string): string {
  const base = API_BASE ? new URL(API_BASE) : new URL(window.location.href);
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${base.host}${API_BASE ? base.pathname.replace(/\/$/, '') : ''}${path}`;
}
