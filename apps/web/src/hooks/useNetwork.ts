import { useEffect, useSyncExternalStore } from 'react';
import { networkMonitor, watchBrowserNetwork, type NetworkSnapshot } from '../lib/network-monitor';

/** The shared, measured network picture. Re-renders only when it actually changes. */
export function useNetwork(): NetworkSnapshot {
  useEffect(() => watchBrowserNetwork(), []);
  return useSyncExternalStore(networkMonitor.subscribe, networkMonitor.get, networkMonitor.get);
}
