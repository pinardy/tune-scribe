// Microphone recording. The raw samples are kept (via an AudioWorklet) so the
// finished take can be analysed with exactly the same code as an audio file;
// an AnalyserNode runs alongside for the live pitch readout.

// emitted as a file of its own (see assetsInlineLimit in vite.config.ts)
import workletUrl from './recorder.worklet.js?url';

export interface Recording {
  pcm: Float32Array;
  sampleRate: number;
}

export interface Recorder {
  /** taps the microphone signal for live display */
  analyser: AnalyserNode;
  sampleRate: number;
  /** seconds recorded so far */
  elapsed(): number;
  /** ends the take and returns everything recorded */
  stop(): Promise<Recording>;
  /** ends the take and throws the audio away */
  cancel(): void;
}

export const DEVICE_STORAGE_KEY = 'scribe.inputDevice';

export function recordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioWorkletNode !== 'undefined'
  );
}

export async function startRecording(): Promise<Recorder> {
  // Same constraints as purrfect-pitch: the browser's voice processing
  // (echo cancelling, noise suppression, automatic gain) is built for speech
  // and mangles sustained musical tones.
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  let preferredId = '';
  try {
    preferredId = localStorage.getItem(DEVICE_STORAGE_KEY) ?? '';
  } catch {
    // storage unavailable — use the default input
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: preferredId ? { ...base, deviceId: { exact: preferredId } } : base,
    });
  } catch (err) {
    // The remembered device may be gone — fall back to the default input
    if (!preferredId) throw err;
    stream = await navigator.mediaDevices.getUserMedia({ audio: base });
  }

  const ctx = new AudioContext();
  try {
    await ctx.resume();
    await ctx.audioWorklet.addModule(workletUrl);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    throw err;
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const chunks: Float32Array[] = [];
  let samples = 0;
  const node = new AudioWorkletNode(ctx, 'pcm-recorder', { numberOfOutputs: 1 });
  let finished: (() => void) | null = null;
  node.port.onmessage = (event: MessageEvent<{ type: 'pcm'; samples: Float32Array } | { type: 'done' }>) => {
    if (event.data.type === 'pcm') {
      chunks.push(event.data.samples);
      samples += event.data.samples.length;
    } else {
      finished?.();
    }
  };
  // The worklet only runs while it is part of a path to the output, so route
  // it there through a silent gain.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(ctx.destination);

  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };

  return {
    analyser,
    sampleRate: ctx.sampleRate,
    elapsed: () => samples / ctx.sampleRate,
    async stop() {
      // ask the worklet for its last partial buffer, but don't wait forever
      await new Promise<void>((resolve) => {
        finished = resolve;
        node.port.postMessage('stop');
        window.setTimeout(resolve, 400);
      });
      release();
      const pcm = new Float32Array(samples);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      return { pcm, sampleRate: ctx.sampleRate };
    },
    cancel() {
      node.port.postMessage('stop');
      release();
    },
  };
}
