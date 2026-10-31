import { useId } from 'react';
import { languageLabel, type Language, type LanguageCode } from '@lingua-bridge/shared';

interface Props {
  languages: readonly Language[];
  source: LanguageCode;
  target: LanguageCode;
  disabled?: boolean;
  onChange: (next: { source: LanguageCode; target: LanguageCode }) => void;
}

export function LanguageBar({ languages, source, target, disabled, onChange }: Props) {
  const sourceId = useId();
  const targetId = useId();

  return (
    <section className="language-bar" aria-label="Languages">
      <div className="language-field">
        <label htmlFor={sourceId}>I speak</label>
        <select
          id={sourceId}
          value={source}
          disabled={disabled}
          onChange={(e) => onChange({ source: e.target.value as LanguageCode, target })}
        >
          {languages.map((language) => (
            <option key={language.code} value={language.code}>
              {languageLabel(language)}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="swap"
        disabled={disabled}
        onClick={() => onChange({ source: target, target: source })}
        aria-label="Swap languages"
        title="Swap languages"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
          <path
            d="M7 7h11l-3-3M17 17H6l3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="language-field">
        <label htmlFor={targetId}>Translate to</label>
        <select
          id={targetId}
          value={target}
          disabled={disabled}
          onChange={(e) => onChange({ source, target: e.target.value as LanguageCode })}
        >
          {languages.map((language) => (
            <option key={language.code} value={language.code}>
              {languageLabel(language)}
            </option>
          ))}
        </select>
      </div>

      {source === target && (
        <p className="language-note">Same language on both sides: you'll get captions only.</p>
      )}
    </section>
  );
}
