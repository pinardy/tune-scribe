// Audio file -> mono samples.

import type { Recording } from './capture';

/** Longest stretch of audio analysed; anything beyond is cut off. */
export const MAX_SECONDS = 10 * 60;

/** Sample rate files are decoded at: enough for the pitch range, a quarter of the memory of 48 kHz stereo. */
const DECODE_RATE = 22050;

/**
 * Decodes any format the browser can play (mp3, m4a, wav, ogg, flac …) and
 * mixes it down to one channel.
 */
export async function decodeAudio(data: ArrayBuffer): Promise<Recording & { truncated: boolean }> {
  let buffer: AudioBuffer;
  try {
    // an offline context decodes straight to the rate we want
    const offline = new OfflineAudioContext(1, 1, DECODE_RATE);
    buffer = await offline.decodeAudioData(data.slice(0));
  } catch {
    // some browsers only accept their hardware rate here
    const ctx = new AudioContext();
    try {
      buffer = await ctx.decodeAudioData(data.slice(0));
    } finally {
      void ctx.close().catch(() => {});
    }
  }

  const limit = Math.min(buffer.length, Math.floor(MAX_SECONDS * buffer.sampleRate));
  const pcm = new Float32Array(limit);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < limit; i++) pcm[i] += channel[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < limit; i++) pcm[i] /= buffer.numberOfChannels;
  }
  return { pcm, sampleRate: buffer.sampleRate, truncated: limit < buffer.length };
}
