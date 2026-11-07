import type {
  ApiError,
  ApiErrorCode,
  HealthResponse,
  LanguageCode,
  LanguagesResponse,
  SpeechRequest,
  UtteranceResponse,
} from '@lingua-bridge/shared';
import { apiUrl, usesSeparateApi } from './config';
import { networkMonitor } from './network-monitor';

/** A failed API call, with a message that is safe to show. */
export class ApiClientError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'NETWORK' | 'ABORTED',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** Worth offering a retry: the same request might succeed later. */
  get retryable(): boolean {
    return ['NETWORK', 'RATE_LIMITED', 'PROVIDER_ERROR', 'INTERNAL'].includes(this.code);
  }
}

export async function request(input: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input.startsWith('/') ? apiUrl(input) : input, init);
  } catch {
    if (init?.signal?.aborted) throw new ApiClientError('ABORTED', 'Request cancelled.');
    throw new ApiClientError(
      'NETWORK',
      !navigator.onLine
        ? "You're offline. Reconnect and try again."
        : usesSeparateApi
          ? "Couldn't reach the translation server. It may be starting up or offline; try again in a moment."
          : "Couldn't reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    let code: ApiErrorCode = 'INTERNAL';
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as Partial<ApiError>;
      if (body.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // Non-JSON error page (for example from a proxy). Keep the generic message.
    }
    throw new ApiClientError(code, message, response.status);
  }
  return response;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await request('/api/health');
  // A static host answers unknown paths with the app's own page instead of a 404, which
  // means this build has no API behind it.
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiClientError(
      'UNAVAILABLE',
      usesSeparateApi
        ? 'The translation server at the configured address answered unexpectedly.'
        : "This site isn't connected to a translation server yet. Set VITE_API_URL to the server's address and redeploy.",
    );
  }
  return response.json() as Promise<HealthResponse>;
}

export async function getLanguages(): Promise<LanguagesResponse> {
  return (await request('/api/languages')).json() as Promise<LanguagesResponse>;
}

export async function sendUtterance(
  input: {
    audio: Blob;
    sourceLanguage: LanguageCode;
    targetLanguage: LanguageCode;
  },
  signal?: AbortSignal,
): Promise<UtteranceResponse> {
  const form = new FormData();
  form.append('sourceLanguage', input.sourceLanguage);
  form.append('targetLanguage', input.targetLanguage);
  form.append('audio', input.audio, 'utterance');
  const startedAt = performance.now();
  const response = await request('/api/utterances', { method: 'POST', body: form, signal });
  const result = (await response.json()) as UtteranceResponse;
  // Measurement is best effort and must never break a send.
  if (result.timings) {
    networkMonitor.addUpload(
      input.audio.size,
      performance.now() - startedAt,
      result.timings.transcribeMs + result.timings.translateMs,
    );
  }
  return result;
}

export async function fetchSpeech(body: SpeechRequest, signal?: AbortSignal): Promise<Blob> {
  const response = await request('/api/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return response.blob();
}
