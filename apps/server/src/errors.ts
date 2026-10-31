import type { ApiErrorCode } from '@lingua-bridge/shared';

/** An error whose message is safe to show to users. */
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * A failure talking to the speech/translation provider.
 * `detail` is for server logs only and is never sent to the client.
 */
export class ProviderError extends AppError {
  constructor(
    readonly operation: 'transcribe' | 'translate' | 'synthesize',
    readonly detail: string,
    readonly upstreamStatus?: number,
  ) {
    super(
      'PROVIDER_ERROR',
      `The ${operation === 'synthesize' ? 'speech' : operation} service is unavailable. Please try again.`,
      502,
    );
    this.name = 'ProviderError';
  }
}
