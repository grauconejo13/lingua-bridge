import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminStatus } from '@lingua-bridge/shared';
import { App } from './App';

const op = { calls: 3, errors: 0, refused: 1, units: 1.5, costUsd: 0.0045, p50Ms: 400, p95Ms: 900 };
const status = (paused = false): AdminStatus => ({
  usage: {
    day: '2026-11-07',
    costUsd: 1.25,
    budgetUsd: 5,
    paused,
    available: !paused,
    unavailableReason: paused ? 'paused' : undefined,
    operations: { transcribe: op, translate: op, synthesize: op },
  },
  live: { rooms: 2, talks: 1, listeners: 40 },
  uptimeSeconds: 3700,
  provider: 'openai',
  demoMode: false,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.pushState({}, '', '/admin');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== 'Bearer right-token-right-token-123') {
      return Response.json({ error: { code: 'BAD_REQUEST', message: 'no' } }, { status: 401 });
    }
    if (url.endsWith('/pause')) {
      return Response.json(status(JSON.parse(String(init?.body)).paused));
    }
    return Response.json(status());
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('admin page', () => {
  it('rejects a wrong token', async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText('Admin token'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not accepted');
  });

  it('shows spend against budget, live counts, and pauses translation', async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText('Admin token'), 'right-token-right-token-123');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByText('$1.25')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: /budget used/ })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('1 h 1 min')).toBeInTheDocument();
    expect(sessionStorage.getItem('lingua-bridge:admin-token')).toBe('right-token-right-token-123');

    await userEvent.click(screen.getByRole('button', { name: 'Pause translation' }));
    expect(await screen.findByRole('button', { name: 'Resume translation' })).toBeInTheDocument();
    expect(screen.getByText('Translation is paused.')).toBeInTheDocument();
  });
});
