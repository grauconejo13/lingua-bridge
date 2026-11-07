import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  seededRandom,
  startImpairedProxy,
  type ImpairedProxy,
} from '../scripts/netsim/impaired-proxy';

/** An echo server, so a round trip through the proxy crosses it twice. */
async function echoServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Sends `bytes` through the proxy and resolves with the elapsed ms once they echo back. */
function roundTrip(port: number, bytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.connect({ port, host: '127.0.0.1' }, () =>
      socket.write(Buffer.alloc(bytes, 7)),
    );
    let received = 0;
    socket.on('data', (chunk) => {
      received += chunk.length;
      if (received >= bytes) {
        socket.destroy();
        resolve(Date.now() - started);
      }
    });
    socket.on('error', reject);
  });
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function setup(profile: Parameters<typeof startImpairedProxy>[0]['profile']) {
  const echo = await echoServer();
  const proxy: ImpairedProxy = await startImpairedProxy({ targetPort: echo.port, profile });
  cleanup.push(() => proxy.close(), echo.close);
  return proxy;
}

describe('impaired proxy', () => {
  it('adds the configured round trip', async () => {
    const proxy = await setup({ name: 't', description: '', rttMs: 200 });
    const ms = await roundTrip(proxy.port, 10);
    expect(ms).toBeGreaterThanOrEqual(190);
    expect(ms).toBeLessThan(600);
  });

  it('limits bandwidth', async () => {
    // 4 KB at 64 kbit/s takes about 500 ms each way.
    const proxy = await setup({
      name: 't',
      description: '',
      rttMs: 0,
      upKbps: 64,
      downKbps: 64,
    });
    const ms = await roundTrip(proxy.port, 4_000);
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(proxy.stats.bytesUp).toBe(4_000);
  });

  it('cuts connections during a reset outage', async () => {
    const proxy = await setup({
      name: 't',
      description: '',
      rttMs: 0,
      outage: { mode: 'reset', everyMs: 150, durationMs: 300 },
    });
    const socket = net.connect({ port: proxy.port, host: '127.0.0.1' });
    const closed = await new Promise<boolean>((resolve) => {
      socket.on('close', () => resolve(true));
      socket.on('error', () => undefined);
      setTimeout(() => resolve(false), 1500);
    });
    expect(closed).toBe(true);
    expect(proxy.stats.outages).toBeGreaterThan(0);
  });

  it('holds traffic during a stall and then delivers it', async () => {
    const proxy = await setup({
      name: 't',
      description: '',
      rttMs: 0,
      outage: { mode: 'stall', everyMs: 50, durationMs: 400 },
    });
    // Wait until the first stall has begun (gap is 35–65 ms after the first duration).
    await new Promise((resolve) => setTimeout(resolve, 480));
    const ms = await roundTrip(proxy.port, 10);
    expect(ms).toBeGreaterThan(100);
  });
});

describe('seededRandom', () => {
  it('repeats for the same seed and stays in [0, 1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const values = Array.from({ length: 100 }, () => a());
    expect(values).toEqual(Array.from({ length: 100 }, () => b()));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
