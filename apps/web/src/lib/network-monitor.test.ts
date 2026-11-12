import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_BITRATE } from '@lingua-bridge/shared';
import { NetworkMonitor } from './network-monitor';

function setup() {
  let now = 0;
  const monitor = new NetworkMonitor(() => now);
  return { monitor, advance: (ms: number) => (now += ms) };
}

afterEach(() => vi.restoreAllMocks());

describe('NetworkMonitor', () => {
  it('starts unknown at a middle bitrate', () => {
    const { monitor } = setup();
    expect(monitor.get().quality).toBe('unknown');
    expect(monitor.get().audioBitrate).toBe(AUDIO_BITRATE.unknown);
  });

  it('classifies from the median RTT, so one spike does not flip the tier', () => {
    const { monitor } = setup();
    [80, 90, 2000, 85, 95].forEach((ms) => monitor.addRtt(ms));
    expect(monitor.get().rttMs).toBe(90);
    expect(monitor.get().quality).toBe('good');
  });

  it('follows a sustained change within a few samples', () => {
    const { monitor } = setup();
    [80, 80, 80, 80, 80].forEach((ms) => monitor.addRtt(ms));
    [1200, 1300, 1250].forEach((ms) => monitor.addRtt(ms));
    expect(monitor.get().quality).toBe('poor');
    expect(monitor.get().audioBitrate).toBe(AUDIO_BITRATE.poor);
  });

  it('drops a slow upload into a lower tier', () => {
    const { monitor } = setup();
    monitor.addRtt(60);
    // 30 KB taking 12 s of network time is 20 kbit/s.
    monitor.addUpload(30_000, 13_000, 1_000);
    expect(monitor.get().uploadKbps).toBe(20);
    expect(monitor.get().quality).toBe('poor');
  });

  it('expires stale samples', () => {
    const { monitor, advance } = setup();
    monitor.addRtt(1500);
    expect(monitor.get().quality).toBe('poor');
    advance(3 * 60_000);
    monitor.update();
    expect(monitor.get().quality).toBe('unknown');
  });

  it('rejects nonsense samples', () => {
    const { monitor } = setup();
    monitor.addRtt(-5);
    monitor.addRtt(Number.NaN);
    monitor.addRtt(120_000);
    expect(monitor.get().rttMs).toBeUndefined();
  });

  it('notifies only when the picture changes', () => {
    const { monitor } = setup();
    const listener = vi.fn();
    monitor.subscribe(listener);
    monitor.addRtt(100);
    monitor.update();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports offline from the browser flag', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { monitor } = setup();
    monitor.addRtt(50);
    expect(monitor.get().quality).toBe('offline');
  });
});
