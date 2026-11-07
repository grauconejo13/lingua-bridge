import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { describeNetwork, type NetworkSnapshot } from '../lib/network-monitor';
import { NetworkSignal, WeakNetworkBanner } from './NetworkSignal';

const snapshot = (patch: Partial<NetworkSnapshot>): NetworkSnapshot => ({
  online: true,
  quality: 'unknown',
  audioBitrate: 24_000,
  ...patch,
});

describe('NetworkSignal', () => {
  it('describes only what was measured', () => {
    expect(describeNetwork(snapshot({}))).toBe('Measuring connection, speech sent at 24 kbit/s');
    expect(
      describeNetwork(
        snapshot({ quality: 'fair', rttMs: 450, uploadKbps: 80, audioBitrate: 20_000 }),
      ),
    ).toBe('Fair connection, 450 ms round trip, about 80 kbit/s upload, speech sent at 20 kbit/s');
  });

  it('exposes the description to screen readers and lights the right bars', () => {
    const { container } = render(
      <NetworkSignal network={snapshot({ quality: 'poor', rttMs: 1200, audioBitrate: 12_000 })} />,
    );
    expect(screen.getByRole('img', { name: /weak connection, 1200 ms/i })).toBeInTheDocument();
    expect(container.querySelectorAll('.bar.on')).toHaveLength(1);
  });

  it('shows the weak-connection banner only on a poor link', () => {
    const { rerender } = render(<WeakNetworkBanner network={snapshot({ quality: 'fair' })} />);
    expect(screen.queryByText(/weak connection/i)).not.toBeInTheDocument();
    rerender(<WeakNetworkBanner network={snapshot({ quality: 'poor' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/weak connection/i);
  });
});
