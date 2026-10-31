import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAutoplayQueue } from './useAutoplayQueue';
import type { SpeechTarget } from './useSpeechPlayer';

const item = (id: string): SpeechTarget => ({ id, text: id, language: 'es' });

function setup(initial: { blocked: boolean; playingId?: string | null }) {
  const play = vi.fn(async (_target: SpeechTarget) => undefined);
  const hook = renderHook(
    ({ blocked, playingId }: { blocked: boolean; playingId: string | null }) =>
      useAutoplayQueue({ player: { play, playingId, loadingId: null }, blocked }),
    { initialProps: { blocked: initial.blocked, playingId: initial.playingId ?? null } },
  );
  return { play, ...hook };
}

describe('useAutoplayQueue', () => {
  it('waits while recording, then plays', () => {
    const { play, result, rerender } = setup({ blocked: true });
    act(() => result.current.enqueue(item('a')));
    expect(play).not.toHaveBeenCalled();

    rerender({ blocked: false, playingId: null });
    expect(play).toHaveBeenCalledWith(item('a'));
  });

  it('plays one item at a time', () => {
    const { play, result, rerender } = setup({ blocked: false });
    act(() => result.current.enqueue(item('a')));
    rerender({ blocked: false, playingId: 'a' });
    act(() => result.current.enqueue(item('b')));
    expect(play).toHaveBeenCalledTimes(1);

    rerender({ blocked: false, playingId: null });
    expect(play).toHaveBeenLastCalledWith(item('b'));
  });

  it('drops queued items when cleared', () => {
    const { play, result, rerender } = setup({ blocked: true });
    act(() => {
      result.current.enqueue(item('a'));
      result.current.clear();
    });
    rerender({ blocked: false, playingId: null });
    expect(play).not.toHaveBeenCalled();
  });

  it('keeps only the most recent few items', () => {
    const { play, result, rerender } = setup({ blocked: true });
    act(() => ['a', 'b', 'c', 'd', 'e'].forEach((id) => result.current.enqueue(item(id))));
    rerender({ blocked: false, playingId: null });
    expect(play).toHaveBeenCalledWith(item('c'));
  });
});
