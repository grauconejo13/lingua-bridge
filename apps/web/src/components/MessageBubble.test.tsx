import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RoomMessage } from '@lingua-bridge/shared';
import { IncomingBubble, OutgoingBubble } from './MessageBubble';

const message: RoomMessage = {
  id: 'm1',
  seq: 1,
  clientMessageId: 'c1',
  senderId: 'me',
  kind: 'speech',
  sourceLanguage: 'en',
  sourceText: 'Where is the station?',
  translations: { en: 'Where is the station?', ja: '駅はどこですか？' },
  createdAt: new Date(0).toISOString(),
  deliveredTo: [],
};

const partner = {
  partnerName: 'Bo',
  partnerLanguage: 'ja' as const,
  partnerId: 'bo',
  partnerConnected: true,
  demo: false,
};

describe('OutgoingBubble', () => {
  it('shows what the other person sees', () => {
    render(<OutgoingBubble message={message} {...partner} />);
    expect(screen.getByText('駅はどこですか？')).toHaveAttribute('lang', 'ja');
    expect(screen.getByText(/Bo sees/)).toBeInTheDocument();
  });

  it('says Sent until the other device acknowledges', () => {
    const { rerender } = render(<OutgoingBubble message={message} {...partner} />);
    expect(screen.getByText(/^Sent$/)).toBeInTheDocument();
    rerender(<OutgoingBubble message={{ ...message, deliveredTo: ['bo'] }} {...partner} />);
    expect(screen.getByText('Delivered')).toBeInTheDocument();
  });

  it('explains when the other person is away', () => {
    render(<OutgoingBubble message={message} {...partner} partnerConnected={false} />);
    expect(screen.getByText(/Bo will get it when they reconnect/)).toBeInTheDocument();
  });
});

describe('IncomingBubble', () => {
  const props = {
    myLanguage: 'ja' as const,
    partnerName: 'Ana',
    demo: false,
    playing: false,
    loadingSpeech: false,
    onPlay: vi.fn(),
    onStop: vi.fn(),
  };

  it('leads with the translation in my language and keeps the original', () => {
    render(<IncomingBubble message={message} {...props} />);
    expect(screen.getByText('駅はどこですか？')).toHaveAttribute('lang', 'ja');
    expect(screen.getByText('Where is the station?')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('button', { name: 'Play in Japanese' })).toBeEnabled();
  });

  it('shows a placeholder while my translation is on its way', () => {
    render(<IncomingBubble message={message} {...props} myLanguage="fr" />);
    expect(screen.getByText('Translating into French…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Play/ })).not.toBeInTheDocument();
  });
});
