// VexFlow rendering of a whole transcription: bars with real note values,
// rests, beams and ties, wrapped into as many systems as the width needs.
//
// Adapted from purrfect-pitch (src/reading/renderScore.ts). Kept from there:
// the SVG backend drawn into a plain div, idempotent re-rendering, staff
// colours read from the theme's CSS variables at render time, and the
// translucent cursor behind the current note. Changed: purrfect-pitch draws
// one unmeasured line of quarter notes and re-renders to recolour them; a
// transcription has durations and many systems, so this lays out measures
// itself and hands back a handle that moves the highlight without redrawing.

import {
  Accidental,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
} from 'vexflow/bravura';
import type { Score, ScoreItem } from '../transcribe/score';
import { letterIndex, vexKey, vexKeySignature } from './theory';

/** Colours the staff is drawn with; taken from the theme's CSS variables. */
export interface StaffInk {
  /** staff lines, bar lines, ledger lines */
  line: string;
  /** clef, key signature, notes and rests */
  ink: string;
}

export const LIGHT_INK: StaffInk = { line: '#17233b', ink: '#17233b' };

/** Reads the staff colours from the CSS variables in force on `el`. */
export function staffInkFrom(el: Element): StaffInk {
  const style = getComputedStyle(el);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    line: read('--staff-line', LIGHT_INK.line),
    ink: read('--staff-ink', LIGHT_INK.ink),
  };
}

export interface ScoreHandle {
  /** Highlights the noteheads of one played note; null clears the highlight. */
  setActive(eventIndex: number | null, scrollIntoView?: boolean): void;
  /** Marks one played note as picked for editing; null clears the mark. */
  setSelected(eventIndex: number | null): void;
}

const NO_SCORE: ScoreHandle = { setActive: () => {}, setSelected: () => {} };

// ---- layout constants (px) ----

/** VexFlow puts the top staff line this far below a stave's y. */
const STAVE_TOP_OFFSET = 40;
const STAFF_HEIGHT = 40;
/** Room above the top line / below the bottom line when no note needs more. */
const MIN_ABOVE = 26;
const MIN_BELOW = 30;
/** Extra room above the first system for the metronome mark. */
const TEMPO_ROOM = 26;
export const SYSTEM_GAP = 14;
/** A system is squeezed this much at most before the page scrolls sideways instead. */
const MIN_SCALE = 0.72;
/** Below this width (a phone held upright) bars are packed tighter, so a line holds more than one. */
const NARROW_WIDTH = 600;
/** The last system is stretched this much at most; beyond that it stays ragged. */
const MAX_LAST_SCALE = 1.35;

const ITEM_WIDTH: Record<string, number> = { w: 56, h: 44, q: 34, '8': 28, '16': 24 };

function naturalWidth(items: ScoreItem[]): number {
  let width = 22;
  for (const item of items) width += ITEM_WIDTH[item.duration] + (item.dotted ? 8 : 0);
  return Math.max(72, width);
}

/** Width a stave needs for its clef, key signature and (optionally) time signature. */
function headerWidth(clef: string, keySignature: string, timeSignature: string | null): number {
  const stave = new Stave(0, 0, 400);
  stave.addClef(clef).addKeySignature(keySignature);
  if (timeSignature) stave.addTimeSignature(timeSignature);
  return Math.ceil(stave.getNoteStartX());
}

export interface System {
  /** indices into score.measures */
  measures: number[];
  header: number;
  scale: number;
  /** px needed above the top staff line and below the bottom one */
  above: number;
  below: number;
}

/** Where everything goes at a given width, worked out before anything is drawn. */
export interface ScoreLayout {
  /** natural width of each measure's contents */
  widths: number[];
  systems: System[];
  /** the drawing's width: the asked-for width, or more if a system cannot be squeezed into it */
  width: number;
  height: number;
}

/** Height of one system, without the gap to the next. */
export function systemHeight(system: System): number {
  return system.above + STAFF_HEIGHT + system.below;
}

export function layoutScore(score: Score, width: number): ScoreLayout | null {
  if (score.measures.length === 0 || width < 120) return null;

  const { clef, meter } = score;
  const keySignature = vexKeySignature(score.key);
  const firstHeader = headerWidth(clef, keySignature, meter.name);
  const otherHeader = headerWidth(clef, keySignature, null);
  const widths = score.measures.map((m) => naturalWidth(m.items));
  const available = width - 2; // 1px either side so the outer bar lines are not clipped

  // ---- pack measures into systems ----
  const systems: System[] = [];
  const packScale = width < NARROW_WIDTH ? MIN_SCALE : 1;
  let current: System | null = null;
  let used = 0;
  widths.forEach((w, i) => {
    if (current && current.header + (used + w) * packScale <= available) {
      current.measures.push(i);
      used += w;
      return;
    }
    current = { measures: [i], header: systems.length === 0 ? firstHeader : otherHeader, scale: 1, above: 0, below: 0 };
    systems.push(current);
    used = w;
  });

  // staff position of the outer lines, as diatonic steps
  const topLine = clef === 'bass' ? letterIndex('A', 3) : letterIndex('F', 5);
  const bottomLine = clef === 'bass' ? letterIndex('G', 2) : letterIndex('E', 4);

  let svgWidth = width;
  systems.forEach((system, s) => {
    const content = system.measures.reduce((sum, i) => sum + widths[i], 0);
    const fit = (available - system.header) / content;
    const isLast = s === systems.length - 1;
    system.scale = Math.max(MIN_SCALE, isLast ? Math.min(fit, MAX_LAST_SCALE) : fit);
    svgWidth = Math.max(svgWidth, Math.ceil(system.header + content * system.scale) + 2);

    // vertical room for ledger-line notes
    let above = MIN_ABOVE + (s === 0 ? TEMPO_ROOM : 0);
    let below = MIN_BELOW;
    for (const i of system.measures) {
      for (const item of score.measures[i].items) {
        if (!item.pitch) continue;
        const step = letterIndex(item.pitch.letter, item.pitch.octave);
        above = Math.max(above, (step - topLine) * 5 + 14 + (s === 0 ? TEMPO_ROOM : 0));
        below = Math.max(below, (bottomLine - step) * 5 + 14);
      }
    }
    system.above = above;
    system.below = below;
  });

  const height =
    systems.reduce((sum, s) => sum + s.above + STAFF_HEIGHT + s.below, 0) + SYSTEM_GAP * (systems.length - 1) + 4;

  return { widths, systems, width: svgWidth, height };
}

type RenderContext = ReturnType<Renderer['getContext']>;

interface Placed {
  el: SVGElement;
  x: number;
  w: number;
  top: number;
}

/**
 * Draws systems `from` up to (not including) `to`, the first of them at the
 * top of the context. Returns where each played note's noteheads ended up
 * (SVG contexts only).
 */
export function drawSystems(
  ctx: RenderContext,
  score: Score,
  layout: ScoreLayout,
  ink: StaffInk,
  from = 0,
  to = layout.systems.length,
): Map<number, Placed[]> {
  const { clef, meter } = score;
  const { systems, widths } = layout;
  const keySignature = vexKeySignature(score.key);
  // anything VexFlow draws without an explicit style still comes out in ink
  ctx.setFillStyle(ink.ink);
  ctx.setStrokeStyle(ink.ink);
  const lineStyle = { strokeStyle: ink.line, fillStyle: ink.line };
  const inkStyle = { strokeStyle: ink.ink, fillStyle: ink.ink };
  const restKey = clef === 'bass' ? 'd/3' : 'b/4';
  const beamGroups = Beam.getDefaultBeamGroups(meter.name);

  /** where each played note's noteheads ended up */
  const placed = new Map<number, Placed[]>();
  const ties: StaveTie[] = [];
  /** a notehead waiting for the note it is tied to; `note` is null when its system is not being drawn */
  let openTie: { note: StaveNote | null; system: number } | null = null;

  let blockTop = 2;
  systems.forEach((system, s) => {
    if (s < from || s >= to) {
      // not on this page, but its ties may reach into or out of it
      for (const measureIndex of system.measures) {
        for (const item of score.measures[measureIndex].items) {
          if (item.kind !== 'note') continue;
          if (openTie?.note) ties.push(new StaveTie({ firstNote: openTie.note, lastNote: null, firstIndexes: [0] }));
          openTie = item.tieToNext ? { note: null, system: s } : null;
        }
      }
      return;
    }
    const staveY = blockTop + system.above - STAVE_TOP_OFFSET;
    let x = 1;

    system.measures.forEach((measureIndex, k) => {
      const first = k === 0;
      const staveWidth = (first ? system.header : 0) + widths[measureIndex] * system.scale;
      const stave = new Stave(x, staveY, staveWidth);
      if (first) {
        stave.addClef(clef).addKeySignature(keySignature);
        if (s === 0) {
          stave.addTimeSignature(meter.name);
          // tempo is kept in quarter notes; compound time is felt, and marked, in dotted quarters
          const compound = meter.beatUnits === 6;
          stave.setTempo(
            { duration: 'q', dots: compound ? 1 : 0, bpm: compound ? Math.round((score.bpm * 2) / 3) : score.bpm },
            0,
          );
        }
      }
      if (measureIndex === score.measures.length - 1) stave.setEndBarType(BarlineType.END);
      stave.setStyle(lineStyle);
      stave.setDefaultLedgerLineStyle(lineStyle);
      for (const modifier of stave.getModifiers()) modifier.setStyle(inkStyle);
      stave.setContext(ctx).draw();
      x += staveWidth;

      const items = score.measures[measureIndex].items;
      const staveNotes = items.map((item) => {
        const dot = item.dotted ? 'd' : '';
        const note =
          item.kind === 'note' && item.pitch
            ? new StaveNote({ keys: [vexKey(item.pitch)], duration: item.duration + dot, clef, autoStem: true })
            : new StaveNote({
                keys: [restKey],
                duration: `${item.duration}${dot}r`,
                clef,
                alignCenter: item.wholeBar,
              });
        if (item.dotted) Dot.buildAndAttach([note], { all: true });
        note.setStyle(inkStyle);
        note.setLedgerLineStyle(lineStyle);
        return note;
      });

      // soft mode: a bar's contents are already known to add up, and a centred
      // whole rest stands for a full bar in any metre
      const voice = new Voice({ numBeats: meter.beats, beatValue: meter.beatValue });
      voice.setMode(Voice.Mode.SOFT);
      voice.addTickables(staveNotes);
      // renders accidentals only where the pitch deviates from the key signature
      // or from earlier accidentals in the bar
      Accidental.applyAccidentals([voice], keySignature);
      const beams = Beam.generateBeams(staveNotes, { groups: beamGroups });
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);
      for (const beam of beams) {
        beam.setStyle(inkStyle);
        // draw() alone ignores the element's style; without this, beams stay black on a dark sheet
        beam.setContext(ctx).drawWithStyle();
      }

      items.forEach((item, i) => {
        if (item.kind !== 'note') return;
        const note = staveNotes[i];
        if (openTie) {
          if (openTie.note && openTie.system === s) {
            ties.push(new StaveTie({ firstNote: openTie.note, lastNote: note, firstIndexes: [0], lastIndexes: [0] }));
          } else {
            // across a line break: a half tie out of the old system and one into the new
            if (openTie.note) ties.push(new StaveTie({ firstNote: openTie.note, lastNote: null, firstIndexes: [0] }));
            ties.push(new StaveTie({ firstNote: null, lastNote: note, lastIndexes: [0] }));
          }
        }
        openTie = item.tieToNext ? { note, system: s } : null;

        const group = note.getSVGElement();
        if (group) {
          const box = note.getBoundingBox();
          const list = placed.get(item.eventIndex) ?? [];
          list.push({ el: group, x: box.x, w: box.w, top: stave.getYForLine(0) });
          placed.set(item.eventIndex, list);
        }
      });
    });

    blockTop += system.above + STAFF_HEIGHT + system.below + SYSTEM_GAP;
  });

  for (const tie of ties) {
    tie.setStyle(inkStyle);
    tie.setContext(ctx).drawWithStyle();
  }

  return placed;
}

export function renderScore(el: HTMLDivElement, score: Score, width: number, ink: StaffInk = LIGHT_INK): ScoreHandle {
  // idempotent: survives StrictMode double-effect and re-renders
  el.innerHTML = '';
  const layout = layoutScore(score, width);
  if (!layout) return NO_SCORE;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(layout.width, layout.height);
  const placed = drawSystems(renderer.getContext(), score, layout, ink);

  // each note can be picked for editing: tag its noteheads, and give them a
  // target a finger can hit (the root svg ignores the pointer; these opt back in)
  for (const [eventIndex, pieces] of placed) {
    for (const p of pieces) {
      p.el.setAttribute('data-event', String(eventIndex));
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hit.setAttribute('class', 'score-hit');
      hit.setAttribute('x', String(p.x - 6));
      hit.setAttribute('y', String(p.top - 16));
      hit.setAttribute('width', String(p.w + 12));
      hit.setAttribute('height', String(STAFF_HEIGHT + 32));
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'none');
      hit.setAttribute('pointer-events', 'all');
      p.el.appendChild(hit);
    }
  }

  // translucent highlight behind the sounding note; positioned by setActive
  const svg = el.querySelector('svg');
  const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  cursor.setAttribute('class', 'score-cursor');
  cursor.setAttribute('rx', '5');
  cursor.setAttribute('visibility', 'hidden');
  svg?.insertBefore(cursor, svg.firstChild);

  let active: number | null = null;
  let selected: number | null = null;
  return {
    setSelected(eventIndex) {
      if (eventIndex === selected) return;
      if (selected !== null) for (const p of placed.get(selected) ?? []) p.el.classList.remove('is-selected');
      selected = eventIndex;
      if (eventIndex !== null) for (const p of placed.get(eventIndex) ?? []) p.el.classList.add('is-selected');
    },
    setActive(eventIndex, scrollIntoView = true) {
      if (eventIndex === active) return;
      if (active !== null) for (const p of placed.get(active) ?? []) p.el.classList.remove('is-sounding');
      active = eventIndex;
      const pieces = eventIndex === null ? undefined : placed.get(eventIndex);
      if (!pieces || pieces.length === 0) {
        cursor.setAttribute('visibility', 'hidden');
        return;
      }
      for (const p of pieces) p.el.classList.add('is-sounding');
      const head = pieces[0];
      cursor.setAttribute('x', String(head.x - 7));
      cursor.setAttribute('y', String(head.top - 16));
      cursor.setAttribute('width', String(head.w + 14));
      cursor.setAttribute('height', String(STAFF_HEIGHT + 32));
      cursor.setAttribute('visibility', 'visible');
      if (scrollIntoView) cursor.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    },
  };
}
