/**
 * Network quality, measured rather than guessed.
 *
 * The client collects two kinds of samples:
 * - round-trip time from timestamped WebSocket pings (`ping.t` echoed in `pong.t`), and
 * - upload throughput from audio sends, with the server's own processing time subtracted.
 *
 * Connection labels such as "4g" are only a fallback when there are no measurements yet,
 * because they describe the radio, not the path to our server.
 */

export type NetworkQuality = 'good' | 'fair' | 'poor' | 'offline' | 'unknown';

export interface NetworkSample {
  /** Median of recent round trips, in ms. */
  rttMs?: number;
  /** Median of recent upload throughput estimates, in kbit/s. */
  uploadKbps?: number;
  online: boolean;
  /** `navigator.connection.effectiveType`, where the browser exposes it. */
  effectiveType?: string;
  /** `navigator.connection.saveData`: the person asked for reduced data use. */
  saveData?: boolean;
}

/** Thresholds for each tier. A tier needs both its RTT and (if measured) throughput. */
export const NETWORK_THRESHOLDS = {
  good: { maxRttMs: 300, minUploadKbps: 96 },
  fair: { maxRttMs: 900, minUploadKbps: 24 },
} as const;

/**
 * Opus speech bitrates per tier. Speech recognition stays usable at 12 kbit/s, and a
 * 30-second turn drops from about 120 KB to about 45 KB.
 */
export const AUDIO_BITRATE: Record<NetworkQuality, number> = {
  good: 32_000,
  unknown: 24_000,
  fair: 20_000,
  poor: 12_000,
  offline: 12_000,
};

export function classifyNetwork(sample: NetworkSample): NetworkQuality {
  if (!sample.online) return 'offline';
  const { rttMs, uploadKbps } = sample;

  if (rttMs === undefined && uploadKbps === undefined) {
    if (sample.effectiveType === 'slow-2g' || sample.effectiveType === '2g') return 'poor';
    return 'unknown';
  }

  const meets = (tier: { maxRttMs: number; minUploadKbps: number }) =>
    (rttMs === undefined || rttMs <= tier.maxRttMs) &&
    (uploadKbps === undefined || uploadKbps >= tier.minUploadKbps);

  if (meets(NETWORK_THRESHOLDS.good)) return 'good';
  if (meets(NETWORK_THRESHOLDS.fair)) return 'fair';
  return 'poor';
}

/** The bitrate to record at. Data saver caps it at the fair tier even on a good link. */
export function audioBitrateFor(quality: NetworkQuality, saveData = false): number {
  const bitrate = AUDIO_BITRATE[quality];
  return saveData ? Math.min(bitrate, AUDIO_BITRATE.fair) : bitrate;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Upload throughput from one HTTP send. `serverMs` is time the server spent working
 * (transcription, translation) and is not network time. Returns undefined when the
 * estimate would be meaningless: tiny bodies are dominated by latency, not bandwidth.
 */
export function uploadKbpsFromSend(
  bytes: number,
  totalMs: number,
  serverMs = 0,
): number | undefined {
  if (bytes < 8_000) return undefined;
  const networkMs = Math.max(totalMs - serverMs, 1);
  return (bytes * 8) / networkMs; // bits per ms = kbit/s
}
