import { useState } from 'react';
import { readPreference, writePreference } from '../lib/storage';
import type { TextSize } from '../types';

const TEXT_SIZES: TextSize[] = ['s', 'm', 'l', 'xl'];

/** Caption size and autoplay, shared by solo and conversation modes. */
export function usePreferences() {
  const [textSize, setTextSizeState] = useState<TextSize>(() =>
    readPreference<TextSize>('textSize', 'm', (v) => TEXT_SIZES.includes(v as TextSize)),
  );
  const [autoplay, setAutoplayState] = useState<boolean>(() =>
    readPreference('autoplay', false, (v) => typeof v === 'boolean'),
  );

  return {
    textSize,
    autoplay,
    setTextSize: (size: TextSize) => {
      setTextSizeState(size);
      writePreference('textSize', size);
    },
    setAutoplay: (value: boolean) => {
      setAutoplayState(value);
      writePreference('autoplay', value);
    },
  };
}
