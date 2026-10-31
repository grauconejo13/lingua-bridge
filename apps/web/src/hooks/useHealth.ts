import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@lingua-bridge/shared';
import { ApiClientError, getHealth } from '../lib/api';

export type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; health: HealthResponse }
  | { status: 'error'; message: string };

async function loadHealthState(): Promise<HealthState> {
  try {
    return { status: 'ok', health: await getHealth() };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof ApiClientError ? error.message : "Couldn't reach the translation server.",
    };
  }
}

export function useHealth() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void loadHealthState().then((state) => {
      if (active) setHealth(state);
    });
    return () => {
      active = false;
    };
  }, []);

  const checkHealth = useCallback(() => {
    setHealth({ status: 'loading' });
    void loadHealthState().then(setHealth);
  }, []);

  const demoMode = health.status === 'ok' && health.health.demoMode;
  return { health, checkHealth, demoMode };
}
