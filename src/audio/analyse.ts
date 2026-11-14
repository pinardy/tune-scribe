import type { AnalysisMessage, AnalysisRequest } from './analysis.worker';
import type { Recording } from './capture';
import type { PitchTrack } from './pitchTrack';

export interface Analysis {
  track: PitchTrack;
  /** the audio as analysed (mono, 16–32 kHz), kept for playback */
  audio: Recording;
}

/** Analyses a recording in a worker. The input buffer is handed over, not copied. */
export function analyse(recording: Recording, onProgress: (fraction: number) => void): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AnalysisMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress(message.fraction);
      } else {
        worker.terminate();
        resolve({ track: message.track, audio: { pcm: message.pcm, sampleRate: message.sampleRate } });
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The analysis stopped unexpectedly.'));
    };
    const request: AnalysisRequest = recording;
    worker.postMessage(request, [recording.pcm.buffer]);
  });
}
