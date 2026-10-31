import type { AppConfig } from '../config';
import { MockProvider } from './mock';
import { OpenAIProvider } from './openai';
import type { SpeechProvider } from './types';

export type { SpeechProvider } from './types';

export function createProvider(config: AppConfig): SpeechProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config.openai);
    case 'mock':
      return new MockProvider();
  }
}
