import net from 'node:net';

/**
 * A TCP proxy that makes a fast local link behave like a bad one, for reproducible tests.
 *
 * What it can simulate:
 * - latency and jitter (half the round trip in each direction),
 * - limited bandwidth, separately for upload (client → server) and download,
 * - outages: either a *stall* (traffic held, then released, like a mobile blip where TCP
 *   recovers on its own) or a *reset* (every connection cut, new ones refused, like a
 *   network handover).
 *
 * What it cannot: packet loss below TCP. A userspace proxy only sees a byte stream, so
 * loss appears here as its consequence (stalls and resets), not as dropped packets. Use
 * OS-level shaping (tc netem, Network Link Conditioner) for that, as docs/BENCHMARKS.md notes.
 *
 * Randomness is seeded, so the same profile and seed give the same schedule.
 */

export interface LinkProfile {
  name: string;
  description: string;
  /** Round-trip time added by the proxy, in ms. */
  rttMs: number;
  /** Random extra delay per chunk, up to this many ms each way. Order is preserved. */
  jitterMs?: number;
  /** Bandwidth limits in kbit/s. Omit for unlimited. */
  upKbps?: number;
  downKbps?: number;
  outage?: {
    mode: 'stall' | 'reset';
    /** Average gap between outages; each gap varies by ±30 %. */
    everyMs: number;
    durationMs: number;
  };
}

export interface ProxyStats {
  connections: number;
  resets: number;
  outages: number;
  bytesUp: number;
  bytesDown: number;
}

export interface ImpairedProxy {
  port: number;
  stats: ProxyStats;
  close(): Promise<void>;
}

/** Small, fast, seedable PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Schedules one direction of a connection: bandwidth first (chunks queue behind each other
 * on the "wire"), then propagation delay with jitter, never reordering.
 */
class Lane {
  private wireFreeAt = 0;
  private lastDeliverAt = 0;
  private timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly oneWayMs: number,
    private readonly jitterMs: number,
    private readonly kbps: number | undefined,
    private readonly random: () => number,
    private readonly holdUntil: () => number,
  ) {}

  push(chunk: Buffer, deliver: (chunk: Buffer) => void): void {
    const now = Date.now();
    const start = Math.max(now, this.wireFreeAt);
    const txMs = this.kbps ? (chunk.length * 8) / this.kbps : 0;
    this.wireFreeAt = start + txMs;
    const jitter = this.jitterMs ? this.random() * this.jitterMs : 0;
    const at = Math.max(this.wireFreeAt + this.oneWayMs + jitter, this.lastDeliverAt);
    this.lastDeliverAt = at;
    this.schedule(at, chunk, deliver);
  }

  private schedule(at: number, chunk: Buffer, deliver: (chunk: Buffer) => void): void {
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        // During a stall, hold everything until it ends, then release in order.
        const held = this.holdUntil();
        if (held > Date.now()) {
          this.lastDeliverAt = Math.max(this.lastDeliverAt, held);
          this.schedule(held, chunk, deliver);
          return;
        }
        deliver(chunk);
      },
      Math.max(0, at - Date.now()),
    );
    this.timers.add(timer);
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
}

export async function startImpairedProxy(options: {
  targetPort: number;
  targetHost?: string;
  profile: LinkProfile;
  seed?: number;
}): Promise<ImpairedProxy> {
  const { profile, targetPort, targetHost = '127.0.0.1' } = options;
  const random = seededRandom(options.seed ?? 1);
  const stats: ProxyStats = { connections: 0, resets: 0, outages: 0, bytesUp: 0, bytesDown: 0 };
  const live = new Set<{ client: net.Socket; upstream: net.Socket; lanes: Lane[] }>();

  let outageUntil = 0;
  const inOutage = () => outageUntil > Date.now();
  const stallUntil = () => (profile.outage?.mode === 'stall' ? outageUntil : 0);

  let outageTimer: NodeJS.Timeout | undefined;
  const scheduleOutage = () => {
    const outage = profile.outage;
    if (!outage) return;
    const gap = outage.everyMs * (0.7 + random() * 0.6);
    outageTimer = setTimeout(() => {
      stats.outages++;
      outageUntil = Date.now() + outage.durationMs;
      if (outage.mode === 'reset') {
        for (const conn of live) {
          stats.resets++;
          conn.client.destroy();
          conn.upstream.destroy();
        }
      }
      scheduleOutage();
    }, gap + outage.durationMs);
  };
  scheduleOutage();

  const server = net.createServer((client) => {
    // A reset-mode outage refuses new connections; a stall leaves them hanging until it ends.
    if (profile.outage?.mode === 'reset' && inOutage()) {
      stats.resets++;
      client.destroy();
      return;
    }
    stats.connections++;
    client.setNoDelay(true);
    const upstream = net.connect({ port: targetPort, host: targetHost });
    upstream.setNoDelay(true);

    const oneWay = profile.rttMs / 2;
    const jitter = profile.jitterMs ?? 0;
    const up = new Lane(oneWay, jitter, profile.upKbps, random, stallUntil);
    const down = new Lane(oneWay, jitter, profile.downKbps, random, stallUntil);
    const conn = { client, upstream, lanes: [up, down] };
    live.add(conn);

    client.on('data', (chunk) => {
      stats.bytesUp += chunk.length;
      up.push(chunk, (c) => upstream.writable && upstream.write(c));
    });
    upstream.on('data', (chunk) => {
      stats.bytesDown += chunk.length;
      down.push(chunk, (c) => client.writable && client.write(c));
    });

    const teardown = () => {
      if (!live.delete(conn)) return;
      up.dispose();
      down.dispose();
      client.destroy();
      upstream.destroy();
    };
    // A clean close (FIN) still has to wait for in-flight data, so delay it by the RTT.
    client.on('end', () => setTimeout(teardown, profile.rttMs + 50));
    upstream.on('end', () => setTimeout(teardown, profile.rttMs + 50));
    client.on('error', teardown);
    upstream.on('error', teardown);
    client.on('close', teardown);
    upstream.on('close', teardown);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('proxy failed to bind');

  return {
    port: address.port,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(outageTimer);
        for (const conn of live) {
          conn.lanes.forEach((lane) => lane.dispose());
          conn.client.destroy();
          conn.upstream.destroy();
        }
        live.clear();
        server.close(() => resolve());
      }),
  };
}

/**
 * Named profiles. The 3G presets match Chrome DevTools' throttling presets so results can
 * be compared with manual browser tests.
 */
export const PROFILES: LinkProfile[] = [
  { name: 'baseline', description: 'Local link, no impairment', rttMs: 0 },
  {
    name: 'good-4g',
    description: '80 ms RTT, 10 Mbit/s up',
    rttMs: 80,
    jitterMs: 20,
    upKbps: 10_000,
    downKbps: 20_000,
  },
  {
    name: 'fast-3g',
    description: 'DevTools "Fast 3G": 563 ms RTT, 675 kbit/s up, 1.44 Mbit/s down',
    rttMs: 563,
    jitterMs: 50,
    upKbps: 675,
    downKbps: 1440,
  },
  {
    name: 'slow-3g',
    description: 'DevTools "Slow 3G": 2 s RTT, 400 kbit/s each way',
    rttMs: 2000,
    jitterMs: 100,
    upKbps: 400,
    downKbps: 400,
  },
  {
    name: 'stalls',
    description: '4G link that freezes for 8 s about every 25 s',
    rttMs: 80,
    jitterMs: 20,
    outage: { mode: 'stall', everyMs: 25_000, durationMs: 8_000 },
  },
  {
    name: 'resets',
    description: '4G link that drops every connection for 3 s about every 15 s',
    rttMs: 80,
    jitterMs: 20,
    outage: { mode: 'reset', everyMs: 15_000, durationMs: 3_000 },
  },
  {
    name: 'worst',
    description: 'Fast 3G plus a 5 s connection drop about every 20 s',
    rttMs: 563,
    jitterMs: 150,
    upKbps: 675,
    downKbps: 1440,
    outage: { mode: 'reset', everyMs: 20_000, durationMs: 5_000 },
  },
];
