/**
 * Recording lengths, keyed by the recorded Blob. The recorders register each blob here and
 * the upload functions report the length to the server, which uses it only to estimate
 * transcription cost. A WeakMap, so nothing outlives the recording itself.
 */
const durations = new WeakMap<Blob, number>();

export function rememberDuration(blob: Blob, durationMs: number): Blob {
  durations.set(blob, durationMs);
  return blob;
}

/** Appends `durationMs` to an upload form when the blob's length is known. */
export function appendDuration(form: FormData, blob: Blob): void {
  const ms = durations.get(blob);
  if (ms !== undefined) form.append('durationMs', String(Math.round(ms)));
}
