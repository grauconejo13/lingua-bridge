import { describeNetwork, type NetworkSnapshot } from '../lib/network-monitor';

const BARS = { good: 3, fair: 2, poor: 1, unknown: 0, offline: 0 } as const;

/** Three signal bars with a full text description for screen readers and on hover. */
export function NetworkSignal({ network }: { network: NetworkSnapshot }) {
  const bars = BARS[network.quality];
  const description = describeNetwork(network);
  return (
    <span
      className={`network-signal is-${network.quality}`}
      role="img"
      aria-label={description}
      title={description}
    >
      {[1, 2, 3].map((n) => (
        <span key={n} className={`bar bar-${n}${n <= bars ? ' on' : ''}`} aria-hidden="true" />
      ))}
    </span>
  );
}

/** Shown only on a measured weak link, with what the app is doing about it. */
export function WeakNetworkBanner({ network }: { network: NetworkSnapshot }) {
  if (network.quality !== 'poor') return null;
  return (
    <p className="banner warning" role="status">
      <strong>Weak connection.</strong> Speech is sent at lower quality to keep it moving, and
      anything that fails is retried. Typing uses the least data.
    </p>
  );
}
