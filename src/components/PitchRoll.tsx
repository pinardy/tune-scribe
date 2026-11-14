// What the app heard, drawn as pitch against time: the raw pitch trace, and
// over it the notes it was cut into. While recording it scrolls live, which
// doubles as the "is the microphone picking me up?" indicator.

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTheme } from '../theme';
import type { NoteEvent } from '../transcribe/segment';

/** Pitch readings collected while recording. */
export interface LiveTrace {
  /** seconds since recording began, one per reading */
  times: number[];
  /** fractional MIDI pitch, NaN where nothing was heard */
  midi: number[];
  /** current input level, 0…1 */
  level: number;
}

export interface HeardTake {
  /** tuning-corrected pitch per analysis frame, NaN where unvoiced */
  contour: Float32Array;
  hopSeconds: number;
  offsetSeconds: number;
  duration: number;
  notes: NoteEvent[];
}

interface Props {
  /** set while recording */
  live: MutableRefObject<LiveTrace> | null;
  take: HeardTake | null;
  activeEvent: number | null;
}

const HEIGHT = 136;
const GUTTER = 30;
/** seconds of live trace kept on screen */
export const LIVE_WINDOW = 8;
/** below this the trace is too cramped to read, so the roll scrolls instead */
const MIN_PX_PER_SECOND = 28;
const MAX_CSS_WIDTH = 6000;
const MAX_BACKING_WIDTH = 8192;

interface Palette {
  grid: string;
  label: string;
  trace: string;
  note: string;
  noteEdge: string;
  marker: string;
  level: string;
}

function palette(el: Element): Palette {
  const style = getComputedStyle(el);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    grid: read('--rule'),
    label: read('--ink-soft'),
    trace: read('--trace'),
    note: read('--note-fill'),
    noteEdge: read('--ink'),
    marker: read('--marker'),
    level: read('--record'),
  };
}

/** Lowest and highest pitch to show: the data's range, padded, never less than an octave. */
function pitchRange(values: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [55, 79];
  lo = Math.floor(lo) - 2;
  hi = Math.ceil(hi) + 2;
  while (hi - lo < 12) {
    lo--;
    hi++;
  }
  return [lo, hi];
}

function drawGrid(c: CanvasRenderingContext2D, colors: Palette, width: number, lo: number, hi: number, y: (m: number) => number) {
  c.font = '10px system-ui, sans-serif';
  c.textBaseline = 'middle';
  c.lineWidth = 1;
  for (let m = Math.ceil(lo); m <= hi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const isC = pc === 0;
    // every C gets a labelled line; other notes only when there is room
    if (!isC && hi - lo > 26) continue;
    c.strokeStyle = colors.grid;
    c.globalAlpha = isC ? 1 : 0.45;
    c.beginPath();
    c.moveTo(GUTTER, Math.round(y(m)) + 0.5);
    c.lineTo(width, Math.round(y(m)) + 0.5);
    c.stroke();
    if (isC) {
      c.globalAlpha = 1;
      c.fillStyle = colors.label;
      c.fillText(`C${Math.floor(m / 12) - 1}`, 4, y(m));
    }
  }
  c.globalAlpha = 1;
}

export default function PitchRoll({ live, take, activeEvent }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const { resolved: theme } = useTheme();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setViewWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // width of the drawing: the view, or wider (and scrollable) for long takes
  const cssWidth =
    take && !live && viewWidth > 0
      ? Math.min(MAX_CSS_WIDTH, Math.max(viewWidth, Math.ceil(GUTTER + take.duration * MIN_PX_PER_SECOND)))
      : viewWidth;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssWidth === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_BACKING_WIDTH / cssWidth);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const c = canvas.getContext('2d');
    if (!c) return;
    const colors = palette(canvas);
    const plotTop = 8;
    const plotHeight = HEIGHT - 16;

    const prepare = (lo: number, hi: number) => {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, cssWidth, HEIGHT);
      const y = (m: number) => plotTop + plotHeight * (1 - (m - lo) / (hi - lo));
      drawGrid(c, colors, cssWidth, lo, hi, y);
      return y;
    };

    if (live) {
      // scrolling live trace: "now" is at the right edge
      let raf = 0;
      let range: [number, number] = [55, 79];
      const pxPerSecond = (cssWidth - GUTTER - 10) / LIVE_WINDOW;
      const frame = () => {
        const { times, midi, level } = live.current;
        const target = pitchRange(midi);
        // ease the range so the picture doesn't jump when one high note arrives
        range = [range[0] + (target[0] - range[0]) * 0.15, range[1] + (target[1] - range[1]) * 0.15];
        const y = prepare(range[0], range[1]);
        const now = times.length ? times[times.length - 1] : 0;
        const right = cssWidth - 10;
        c.fillStyle = colors.trace;
        for (let i = 0; i < times.length; i++) {
          if (Number.isNaN(midi[i])) continue;
          const x = right - (now - times[i]) * pxPerSecond;
          if (x < GUTTER) continue;
          c.beginPath();
          c.arc(x, y(midi[i]), 1.8, 0, Math.PI * 2);
          c.fill();
        }
        // input level, so silence and "too quiet" are distinguishable from "not listening"
        const meter = Math.min(1, Math.sqrt(level) * 2.2) * plotHeight;
        c.fillStyle = colors.level;
        c.fillRect(cssWidth - 5, plotTop + plotHeight - meter, 3, meter);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
    }

    if (!take) {
      prepare(55, 79);
      return;
    }

    // a tune that came as a link has its notes but no trace of how they were sung
    const [lo, hi] = pitchRange(take.contour.length > 0 ? take.contour : take.notes.map((n) => n.midi));
    const y = prepare(lo, hi);
    const pxPerSecond = (cssWidth - GUTTER) / Math.max(take.duration, 0.001);
    const x = (seconds: number) => GUTTER + seconds * pxPerSecond;
    const row = plotHeight / (hi - lo);

    // the notes it was cut into
    take.notes.forEach((note, index) => {
      const left = x(note.start);
      const w = Math.max(2, x(note.end) - left - 1);
      const h = Math.max(5, Math.min(12, row));
      c.fillStyle = index === activeEvent ? colors.marker : colors.note;
      c.strokeStyle = colors.noteEdge;
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(left, y(note.midi) - h / 2, w, h, 2.5);
      c.fill();
      c.globalAlpha = index === activeEvent ? 1 : 0.55;
      c.stroke();
      c.globalAlpha = 1;
    });

    // the raw pitch trace on top
    c.strokeStyle = colors.trace;
    c.lineWidth = 1.5;
    c.lineJoin = 'round';
    c.beginPath();
    let pen = false;
    for (let i = 0; i < take.contour.length; i++) {
      const m = take.contour[i];
      if (Number.isNaN(m)) {
        pen = false;
        continue;
      }
      const px = x(take.offsetSeconds + i * take.hopSeconds);
      if (pen) c.lineTo(px, y(m));
      else c.moveTo(px, y(m));
      pen = true;
    }
    c.stroke();
  }, [live, take, activeEvent, cssWidth, theme]);

  // keep the sounding note in view on long takes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !take || live || activeEvent === null || cssWidth <= viewWidth) return;
    const note = take.notes[activeEvent];
    if (!note) return;
    const px = GUTTER + (note.start / Math.max(take.duration, 0.001)) * (cssWidth - GUTTER);
    if (px < el.scrollLeft + 40 || px > el.scrollLeft + viewWidth - 60) {
      el.scrollTo({ left: Math.max(0, px - viewWidth / 3), behavior: 'smooth' });
    }
  }, [activeEvent, take, live, cssWidth, viewWidth]);

  return (
    <div ref={scrollRef} className="roll" data-testid="roll">
      <canvas
        ref={canvasRef}
        style={{ width: cssWidth || '100%', height: HEIGHT }}
        role="img"
        aria-label={
          live
            ? 'Live pitch of the microphone input'
            : take
              ? `Pitch trace of the take with ${take.notes.length} detected notes`
              : 'Pitch trace, empty until something is recorded'
        }
      />
    </div>
  );
}
