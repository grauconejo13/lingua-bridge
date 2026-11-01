import type {
  ApiError,
  ApiErrorCode,
  HealthResponse,
  LanguageCode,
  LanguagesResponse,
  SpeechRequest,
  UtteranceResponse,
} from '@lingua-bridge/shared';

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
    response = await fetch(input, init);
  } catch {
    if (init?.signal?.aborted) throw new ApiClientError('ABORTED', 'Request cancelled.');
    throw new ApiClientError(
      'NETWORK',
      navigator.onLine
        ? "Couldn't reach the server. Check your connection and try again."
        : "You're offline. Reconnect and try again.",
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
  return (await request('/api/health')).json() as Promise<HealthResponse>;
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
  const response = await request('/api/utterances', { method: 'POST', body: form, signal });
  return response.json() as Promise<UtteranceResponse>;
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
