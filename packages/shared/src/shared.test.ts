import { describe, expect, it } from 'vitest';
import {
  LANGUAGES,
  baseMimeType,
  getLanguage,
  isAcceptedAudioType,
  isLanguageCode,
  languageLabel,
} from './index';

describe('language registry', () => {
  it('has unique codes', () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('validates codes', () => {
    expect(isLanguageCode('ja')).toBe(true);
    expect(isLanguageCode('xx')).toBe(false);
    expect(isLanguageCode(42)).toBe(false);
  });

  it('marks right-to-left scripts', () => {
    expect(getLanguage('ar').dir).toBe('rtl');
    expect(getLanguage('en').dir).toBe('ltr');
  });

  it('builds readable labels', () => {
    expect(languageLabel(getLanguage('en'))).toBe('English');
    expect(languageLabel(getLanguage('ja'))).toBe('Japanese · 日本語');
  });
});

describe('audio types', () => {
  it('strips codec parameters', () => {
    expect(baseMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseMimeType(' Audio/MP4 ')).toBe('audio/mp4');
  });

  it('accepts browser recording formats and rejects others', () => {
    expect(isAcceptedAudioType('audio/webm;codecs=opus')).toBe(true);
    expect(isAcceptedAudioType('audio/mp4')).toBe(true);
    expect(isAcceptedAudioType('video/webm')).toBe(false);
    expect(isAcceptedAudioType('text/plain')).toBe(false);
  });
});
