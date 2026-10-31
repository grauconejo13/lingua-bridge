/** 840 → "0.84 s", 12_300 → "12.3 s" */
export function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
}

/** 4_500 → "0:04" */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
