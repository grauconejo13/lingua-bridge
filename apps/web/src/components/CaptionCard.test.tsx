import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Caption } from '../types';
import { CaptionCard } from './CaptionCard';

const handlers = () => ({
  onPlay: vi.fn(),
  onStop: vi.fn(),
  onRetry: vi.fn(),
  onDiscard: vi.fn(),
});

const done: Caption = {
  id: 'c1',
  status: 'done',
  sourceLanguage: 'en',
  targetLanguage: 'ar',
  stoppedAt: 0,
  sourceText: 'Good morning',
  translatedText: 'صباح الخير',
  timings: { transcribeMs: 400, translateMs: 300, totalMs: 700 },
  clientMs: 840,
  demo: false,
};

describe('CaptionCard', () => {
  it('marks each text with its language and lets the browser detect direction', () => {
    render(<CaptionCard caption={done} playing={false} loadingSpeech={false} {...handlers()} />);
    const translation = screen.getByText('صباح الخير');
    expect(translation).toHaveAttribute('lang', 'ar');
    expect(translation).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Good morning')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('0.84 s')).toBeInTheDocument();
  });

  it('labels demo output', () => {
    render(
      <CaptionCard
        caption={{ ...done, demo: true }}
        playing={false}
        loadingSpeech={false}
        {...handlers()}
      />,
    );
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });

  it('plays and stops speech', async () => {
    const h = handlers();
    const { rerender } = render(
      <CaptionCard caption={done} playing={false} loadingSpeech={false} {...h} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Arabic speech' }));
    expect(h.onPlay).toHaveBeenCalled();

    rerender(<CaptionCard caption={done} playing loadingSpeech={false} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop speech' }));
    expect(h.onStop).toHaveBeenCalled();
  });

  it('offers retry for retryable failures', async () => {
    const h = handlers();
    render(
      <CaptionCard
        caption={{
          id: 'c2',
          status: 'failed',
          sourceLanguage: 'en',
          targetLanguage: 'es',
          stoppedAt: 0,
          message: "You're offline.",
          retryable: true,
          audio: new Blob(['x']),
        }}
        playing={false}
        loadingSpeech={false}
        {...h}
      />,
    );
    expect(screen.getByText("You're offline.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.onRetry).toHaveBeenCalled();
  });

  it('hides retry when retrying would not help', () => {
    render(
      <CaptionCard
        caption={{
          id: 'c3',
          status: 'failed',
          sourceLanguage: 'en',
          targetLanguage: 'es',
          stoppedAt: 0,
          message: "Didn't catch any speech.",
          retryable: false,
          audio: new Blob(['x']),
        }}
        playing={false}
        loadingSpeech={false}
        {...handlers()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });
});
