// AudioWorklet that hands raw microphone samples to the main thread.
//
// Plain JavaScript on purpose: it is loaded by URL into the audio rendering
// thread (see capture.ts), where there is no bundler runtime and no DOM.
// Samples are batched so the main thread gets ~12 messages a second rather
// than one per 128-sample render quantum.

class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.filled = 0;
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.flush();
        this.running = false;
        this.port.postMessage({ type: 'done' });
      }
    };
  }

  flush() {
    if (this.filled === 0) return;
    const samples = this.buffer.slice(0, this.filled);
    this.port.postMessage({ type: 'pcm', samples }, [samples.buffer]);
    this.filled = 0;
  }

  process(inputs) {
    if (!this.running) return false;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      // mix to mono
      let sum = 0;
      for (let c = 0; c < channels.length; c++) sum += channels[c][i];
      this.buffer[this.filled++] = sum / channels.length;
      if (this.filled === this.buffer.length) this.flush();
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorder);
