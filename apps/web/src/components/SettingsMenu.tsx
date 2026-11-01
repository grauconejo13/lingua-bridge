import type { TextSize } from '../types';

const SIZES: { value: TextSize; label: string }[] = [
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large' },
  { value: 'xl', label: 'Extra large' },
];

interface Props {
  textSize: TextSize;
  autoplay: boolean;
  canClear: boolean;
  clearLabel?: string;
  onTextSize: (size: TextSize) => void;
  onAutoplay: (value: boolean) => void;
  onClear: () => void;
}

export function SettingsMenu({
  textSize,
  autoplay,
  canClear,
  clearLabel = 'Clear conversation',
  onTextSize,
  onAutoplay,
  onClear,
}: Props) {
  return (
    <details className="settings">
      <summary>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M4 7h10M18 7h2M4 17h2M10 17h10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="8" cy="17" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="settings-label">Settings</span>
      </summary>
      <div className="settings-panel">
        <fieldset>
          <legend>Caption size</legend>
          <div className="segmented">
            {SIZES.map((size) => (
              <label key={size.value}>
                <input
                  type="radio"
                  name="text-size"
                  value={size.value}
                  checked={textSize === size.value}
                  onChange={() => onTextSize(size.value)}
                />
                <span>{size.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="toggle">
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(e) => onAutoplay(e.target.checked)}
          />
          <span>Speak each translation automatically</span>
        </label>

        <button type="button" className="button ghost" onClick={onClear} disabled={!canClear}>
          {clearLabel}
        </button>
        <p className="fine-print">
          Captions live only in this tab and disappear when you close it.
        </p>
      </div>
    </details>
  );
}
