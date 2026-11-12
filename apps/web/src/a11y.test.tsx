import { act, render } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

/**
 * Structural accessibility checks in CI. jsdom has no layout, so colour contrast is checked
 * separately in a real browser (see docs/ACCESSIBILITY.md).
 */
async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

class SilentSocket {
  static OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', SilentSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        status: 'ok',
        provider: 'mock',
        demoMode: true,
        limits: { maxAudioBytes: 1, maxTtsChars: 1 },
        available: true,
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe.each([
  ['one-device translator', '/'],
  ['conversation start', '/conversation'],
  ['conversation invite', '/r/abc123#secret'],
  ['presentation start', '/present'],
  ['presenter', '/present/talk1#key'],
  ['audience', '/t/talk1'],
  ['admin sign-in', '/admin'],
])('%s', (_name, url) => {
  it('has no structural accessibility violations', async () => {
    window.history.pushState({}, '', url);
    render(<App />);
    await act(async () => undefined);
    expect(await violations()).toEqual([]);
  });
});
