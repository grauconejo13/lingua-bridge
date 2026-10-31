import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoloPage as App } from './SoloPage';

function stubHealth(demoMode: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        status: 'ok',
        provider: demoMode ? 'mock' : 'openai',
        demoMode,
        limits: { maxAudioBytes: 1, maxTtsChars: 1 },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SoloPage', () => {
  it('does not request the microphone until asked', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', class {});
    stubHealth(false);

    render(<App />);

    expect(await screen.findByRole('button', { name: /turn on microphone/i })).toBeVisible();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('says plainly when the server is in demo mode', async () => {
    stubHealth(true);
    render(<App />);
    expect(await screen.findByText('Demo mode.')).toBeInTheDocument();
    expect(screen.getByText('Demo server')).toBeInTheDocument();
  });

  it('swaps languages and remembers the choice', async () => {
    stubHealth(false);
    render(<App />);
    const speak = screen.getByLabelText('I speak') as HTMLSelectElement;
    const target = screen.getByLabelText('Translate to') as HTMLSelectElement;
    await userEvent.selectOptions(speak, 'ja');
    await userEvent.selectOptions(target, 'fr');

    await userEvent.click(screen.getByRole('button', { name: 'Swap languages' }));

    expect(speak.value).toBe('fr');
    expect(target.value).toBe('ja');
    expect(localStorage.getItem('lingua-bridge:source')).toBe('"fr"');
  });

  it('explains when recording is not supported', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    stubHealth(false);
    render(<App />);
    expect(await screen.findByText(/can't record audio/i)).toBeInTheDocument();
  });
});
