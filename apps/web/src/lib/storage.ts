/**
 * Small preferences only (languages, text size, autoplay). Never captions or audio.
 * Storage can be unavailable (private mode, blocked site data), so every call is guarded.
 */
const PREFIX = 'lingua-bridge:';

export function readPreference<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => boolean,
): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore: preferences are a convenience.
  }
}
