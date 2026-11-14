// Runs pitch tracking off the main thread so the page stays responsive while
// a long track is analysed.

import type { PitchTrack } from './pitchTrack';
import { prepareForAnalysis, trackPitch } from './pitchTrack';

export interface AnalysisRequest {
  pcm: Float32Array;
  sampleRate: number;
}

export type AnalysisMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; track: PitchTrack; pcm: Float32Array; sampleRate: number };

// The app's tsconfig targets the DOM, not the worker scope; this is the slice of it used here.
interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage(message: AnalysisMessage, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const prepared = prepareForAnalysis(event.data.pcm, event.data.sampleRate);
  const track = trackPitch(prepared.pcm, prepared.sampleRate, {
    onProgress: (fraction) => scope.postMessage({ type: 'progress', fraction }),
  });
  // the prepared audio goes back too, for playing the recording against the score
  scope.postMessage({ type: 'done', track, pcm: prepared.pcm, sampleRate: prepared.sampleRate }, [
    track.midi.buffer,
    track.rms.buffer,
    prepared.pcm.buffer,
  ]);
};
