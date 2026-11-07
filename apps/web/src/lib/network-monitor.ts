import {
  audioBitrateFor,
  classifyNetwork,
  median,
  uploadKbpsFromSend,
  type NetworkQuality,
  type NetworkSample,
} from '@lingua-bridge/shared';

/** How many recent samples each median uses. Small, so the tier follows real changes. */
const RTT_WINDOW = 5;
const UPLOAD_WINDOW = 3;
/** Samples older than this no longer describe the connection. */
const SAMPLE_TTL_MS = 2 * 60_000;

interface Timed {
  value: number;
  at: number;
}

export interface NetworkSnapshot extends NetworkSample {
  quality: NetworkQuality;
  /** The bitrate the recorder should use right now. */
  audioBitrate: number;
}

interface ConnectionInfo {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

function connectionInfo(): ConnectionInfo | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { connection?: ConnectionInfo }).connection;
}

/**
 * Collects round-trip and throughput samples and classifies the connection. One instance
 * is shared by the whole app so the solo translator and conversations agree.
 */
export class NetworkMonitor {
  private rtt: Timed[] = [];
  private upload: Timed[] = [];
  private listeners = new Set<() => void>();
  private snapshot: NetworkSnapshot;

  constructor(private now: () => number = () => Date.now()) {
    this.snapshot = this.compute();
  }

  addRtt(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60_000) return;
    this.rtt = [...this.rtt, { value: ms, at: this.now() }].slice(-RTT_WINDOW);
    this.update();
  }

  /** Record one upload. `serverMs` is the server-reported processing time to subtract. */
  addUpload(bytes: number, totalMs: number, serverMs = 0): void {
    const kbps = uploadKbpsFromSend(bytes, totalMs, serverMs);
    if (kbps === undefined) return;
    this.upload = [...this.upload, { value: kbps, at: this.now() }].slice(-UPLOAD_WINDOW);
    this.update();
  }

  /** Re-read browser state (online, connection type) and expire stale samples. */
  update = (): void => {
    const next = this.compute();
    const prev = this.snapshot;
    this.snapshot = next;
    if (
      next.quality !== prev.quality ||
      next.rttMs !== prev.rttMs ||
      next.uploadKbps !== prev.uploadKbps ||
      next.audioBitrate !== prev.audioBitrate
    ) {
      this.listeners.forEach((listener) => listener());
    }
  };

  get = (): NetworkSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Forget everything, for tests and when a page wants a fresh start. */
  reset(): void {
    this.rtt = [];
    this.upload = [];
    this.update();
  }

  private compute(): NetworkSnapshot {
    const cutoff = this.now() - SAMPLE_TTL_MS;
    const fresh = (samples: Timed[]) => samples.filter((s) => s.at >= cutoff).map((s) => s.value);
    const connection = connectionInfo();
    const sample: NetworkSample = {
      rttMs: round(median(fresh(this.rtt))),
      uploadKbps: round(median(fresh(this.upload))),
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      effectiveType: connection?.effectiveType,
      saveData: connection?.saveData,
    };
    const quality = classifyNetwork(sample);
    return { ...sample, quality, audioBitrate: audioBitrateFor(quality, sample.saveData) };
  }
}

function round(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value);
}

export const networkMonitor = new NetworkMonitor();

let watching = false;
/** Follow browser events that change the picture without a new sample. Idempotent. */
export function watchBrowserNetwork(monitor = networkMonitor): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('online', monitor.update);
  window.addEventListener('offline', monitor.update);
  connectionInfo()?.addEventListener?.('change', monitor.update);
  // Let stale samples age out even when nothing else happens.
  window.setInterval(monitor.update, 30_000);
}

const LABELS = {
  good: 'Strong connection',
  fair: 'Fair connection',
  poor: 'Weak connection',
  unknown: 'Measuring connection',
  offline: 'Offline',
} as const;

/** What was measured, in words, so the indicator never claims more than it knows. */
export function describeNetwork(network: NetworkSnapshot): string {
  const parts: string[] = [LABELS[network.quality]];
  if (network.rttMs !== undefined) parts.push(`${network.rttMs} ms round trip`);
  if (network.uploadKbps !== undefined) parts.push(`about ${network.uploadKbps} kbit/s upload`);
  if (network.quality !== 'offline') {
    parts.push(`speech sent at ${Math.round(network.audioBitrate / 1000)} kbit/s`);
  }
  return parts.join(', ');
}
