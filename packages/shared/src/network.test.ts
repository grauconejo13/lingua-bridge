import { describe, expect, it } from 'vitest';
import {
  AUDIO_BITRATE,
  audioBitrateFor,
  classifyNetwork,
  median,
  uploadKbpsFromSend,
} from './network';

describe('classifyNetwork', () => {
  it('is offline whenever the browser says so', () => {
    expect(classifyNetwork({ online: false, rttMs: 20 })).toBe('offline');
  });

  it('is unknown with no measurements, except on a 2G label', () => {
    expect(classifyNetwork({ online: true })).toBe('unknown');
    expect(classifyNetwork({ online: true, effectiveType: '4g' })).toBe('unknown');
    expect(classifyNetwork({ online: true, effectiveType: '2g' })).toBe('poor');
  });

  it('prefers measurements over connection labels', () => {
    expect(classifyNetwork({ online: true, rttMs: 80, effectiveType: '2g' })).toBe('good');
    expect(classifyNetwork({ online: true, rttMs: 1500, effectiveType: '4g' })).toBe('poor');
  });

  it('uses round trip time alone when throughput is unmeasured', () => {
    expect(classifyNetwork({ online: true, rttMs: 300 })).toBe('good');
    expect(classifyNetwork({ online: true, rttMs: 301 })).toBe('fair');
    expect(classifyNetwork({ online: true, rttMs: 900 })).toBe('fair');
    expect(classifyNetwork({ online: true, rttMs: 901 })).toBe('poor');
  });

  it('needs both RTT and throughput to qualify for a tier', () => {
    expect(classifyNetwork({ online: true, rttMs: 50, uploadKbps: 500 })).toBe('good');
    expect(classifyNetwork({ online: true, rttMs: 50, uploadKbps: 60 })).toBe('fair');
    expect(classifyNetwork({ online: true, rttMs: 50, uploadKbps: 10 })).toBe('poor');
    expect(classifyNetwork({ online: true, uploadKbps: 200 })).toBe('good');
  });
});

describe('audioBitrateFor', () => {
  it('lowers the bitrate as quality drops', () => {
    expect(audioBitrateFor('good')).toBeGreaterThan(audioBitrateFor('fair'));
    expect(audioBitrateFor('fair')).toBeGreaterThan(audioBitrateFor('poor'));
  });

  it('caps at the fair tier when data saver is on', () => {
    expect(audioBitrateFor('good', true)).toBe(AUDIO_BITRATE.fair);
    expect(audioBitrateFor('poor', true)).toBe(AUDIO_BITRATE.poor);
  });
});

describe('median', () => {
  it('handles empty, odd and even inputs without mutating them', () => {
    expect(median([])).toBeUndefined();
    const values = [5, 1, 3];
    expect(median(values)).toBe(3);
    expect(values).toEqual([5, 1, 3]);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('uploadKbpsFromSend', () => {
  it('ignores bodies too small to measure bandwidth', () => {
    expect(uploadKbpsFromSend(2_000, 100)).toBeUndefined();
  });

  it('subtracts server processing time', () => {
    // 40 KB in 2 s total, 1.6 s of which was transcription: 320 kbit over 0.4 s.
    expect(uploadKbpsFromSend(40_000, 2_000, 1_600)).toBe(800);
  });

  it('never divides by zero when server time exceeds the total', () => {
    expect(uploadKbpsFromSend(10_000, 100, 500)).toBe(80_000);
  });
});
