// The sampled piano the score is played with: a grand piano recorded every
// six semitones (see scripts/build-piano.sh), each sample shifted by up to
// three semitones to cover the notes between. The files are fetched ahead of
// time and decoded at the first play; until they are ready, or if they
// cannot be had, playback falls back to the synthesised voice.

const urls = import.meta.glob<string>('./piano/*.mp3', { query: '?url', import: 'default', eager: true });

interface Sample {
  midi: number;
  buffer: AudioBuffer;
}

let fetched: Promise<{ midi: number; data: ArrayBuffer }[]> | null = null;
let decoded: { audio: AudioContext; samples: Promise<Sample[] | null> } | null = null;
/** the samples, once decoded for the context in use */
let ready: { audio: AudioContext; samples: Sample[] } | null = null;

/** Starts downloading the samples. Safe to call early and often; needs no audio context. */
export function fetchPiano(): Promise<{ midi: number; data: ArrayBuffer }[]> {
  fetched ??= Promise.all(
    Object.entries(urls).map(async ([path, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Piano sample ${path} could not be fetched.`);
      return { midi: Number(/(\d+)\.mp3$/.exec(path)![1]), data: await response.arrayBuffer() };
    }),
  );
  // a failed download may be tried again later
  fetched.catch(() => (fetched = null));
  return fetched;
}

/** Resolves when the piano can be played in `audio`, or with false if it cannot be. */
export function preparePiano(audio: AudioContext): Promise<boolean> {
  if (decoded?.audio !== audio) {
    const samples = fetchPiano()
      .then((files) =>
        Promise.all(
          // decodeAudioData takes the buffer for itself; give it a copy so the download can be reused
          files.map(async ({ midi, data }) => ({ midi, buffer: await audio.decodeAudioData(data.slice(0)) })),
        ),
      )
      .then((list) => {
        list.sort((a, b) => a.midi - b.midi);
        ready = { audio, samples: list };
        return list;
      })
      .catch(() => null);
    decoded = { audio, samples };
  }
  return decoded.samples.then((list) => list !== null);
}

export function pianoReady(audio: AudioContext): boolean {
  return ready?.audio === audio;
}

/**
 * One note of the sampled piano, damped at `t0 + held`. Call only once
 * pianoReady(audio). Returns the source, so the note can be cut short.
 */
export function strikeSample(
  audio: AudioContext,
  output: AudioNode,
  midi: number,
  t0: number,
  held: number,
): AudioScheduledSourceNode {
  const samples = ready!.samples;
  let nearest = samples[0];
  for (const sample of samples) {
    if (Math.abs(sample.midi - midi) < Math.abs(nearest.midi - midi)) nearest = sample;
  }
  const source = audio.createBufferSource();
  source.buffer = nearest.buffer;
  source.playbackRate.value = 2 ** ((midi - nearest.midi) / 12);
  const gain = audio.createGain();
  // the samples are recorded well below full scale
  gain.gain.setValueAtTime(2.6, t0);
  gain.gain.setTargetAtTime(0, t0 + held, 0.08); // the damper
  source.connect(gain).connect(output);
  source.start(t0);
  source.stop(t0 + held + 0.6);
  return source;
}
