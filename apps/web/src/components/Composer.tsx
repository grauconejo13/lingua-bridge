import { useId, useState, type FormEvent } from 'react';
import { ROOM_MAX_TEXT_CHARS } from '@lingua-bridge/shared';

interface Props {
  disabled?: boolean;
  onSend: (text: string) => void;
}

/** Typed fallback: for noisy places, a muted mic, or when speech recognition struggles. */
export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('');
  const inputId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor={inputId} className="visually-hidden">
        Type a message
      </label>
      <input
        id={inputId}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={ROOM_MAX_TEXT_CHARS}
        placeholder="Type instead…"
        autoComplete="off"
        enterKeyHint="send"
        disabled={disabled}
      />
      <button type="submit" className="button primary" disabled={disabled || !text.trim()}>
        Send
      </button>
    </form>
  );
}
