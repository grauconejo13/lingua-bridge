import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function go(url: string) {
  window.history.pushState({}, '', url);
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        status: 'ok',
        provider: 'mock',
        demoMode: true,
        limits: { maxAudioBytes: 1, maxTtsChars: 1 },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  go('/');
});

describe('routing', () => {
  it('shows the one-device translator at /', () => {
    go('/');
    render(<App />);
    expect(screen.getByLabelText('Translate to')).toBeInTheDocument();
  });

  it('shows the start screen at /conversation', () => {
    go('/conversation');
    render(<App />);
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeInTheDocument();
  });

  it('explains a room link without its secret', () => {
    go('/r/abc123');
    render(<App />);
    expect(screen.getByText('This link is incomplete')).toBeInTheDocument();
  });

  it('asks an invited person for their language before joining', async () => {
    const sockets: string[] = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;
        readyState = 0;
        constructor(url: string) {
          sockets.push(url);
        }
        send() {}
        close() {}
      },
    );
    go('/r/abc123#secret-value');
    render(<App />);

    expect(screen.getByText("You've been invited to a conversation")).toBeInTheDocument();
    expect(sockets).toHaveLength(0);

    await userEvent.selectOptions(screen.getByLabelText('I speak'), 'ko');
    await userEvent.click(screen.getByRole('button', { name: 'Join conversation' }));

    expect(sockets[0]).toMatch(/\/api\/rooms\/ws$/);
    expect(JSON.parse(localStorage.getItem('lingua-bridge:room:abc123')!)).toMatchObject({
      language: 'ko',
    });
    expect(screen.getByText('Waiting for the other person')).toBeInTheDocument();
  });
});
