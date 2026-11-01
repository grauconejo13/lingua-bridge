import type { FastifyRequest } from 'fastify';
import { isAcceptedAudioType } from '@lingua-bridge/shared';
import { AppError } from './errors';

export interface AudioUpload {
  fields: Record<string, string>;
  audio: Buffer;
  mimeType: string;
}

/**
 * Reads a multipart body with one `audio` file and a few text fields, in any order.
 * Size limits come from the multipart plugin's configuration.
 */
export async function readAudioUpload(request: FastifyRequest): Promise<AudioUpload> {
  if (!request.isMultipart()) {
    throw new AppError('BAD_REQUEST', 'Expected multipart/form-data.', 400);
  }

  const fields: Record<string, string> = {};
  let audio: Buffer | undefined;
  let mimeType = '';

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'audio') {
        await part.toBuffer();
        continue;
      }
      mimeType = part.mimetype;
      if (!isAcceptedAudioType(mimeType)) {
        throw new AppError(
          'UNSUPPORTED_AUDIO',
          `Unsupported audio format (${mimeType || 'unknown'}).`,
          415,
        );
      }
      audio = await part.toBuffer();
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }

  if (!audio || audio.byteLength === 0) {
    throw new AppError('BAD_REQUEST', 'Missing audio recording.', 400);
  }
  return { fields, audio, mimeType };
}
