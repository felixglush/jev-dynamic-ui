/** Shared by the browser (to stop recording) and the server (to refuse oversize clips). */
export const MAX_RECORDING_MS = 20_000;
/** A 20 s clip from MediaRecorder is a few hundred KB; this also stays under Next's 1 MB Server Action body limit. */
export const MAX_AUDIO_BYTES = 900_000;
