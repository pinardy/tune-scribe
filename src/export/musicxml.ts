// MusicXML 4.0 (score-partwise) export, so a transcription can be opened and
// cleaned up in MuseScore, Dorico, Sibelius, Finale and the like.

import { ACC_OFFSET, signatureCount } from '../notation/theory';
import type { DurationName, Score, ScoreItem } from '../transcribe/score';

const TYPE_NAMES: Record<DurationName, string> = {
  w: 'whole',
  h: 'half',
  q: 'quarter',
  '8': 'eighth',
  '16': '16th',
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 12 divisions to the quarter: a sixteenth is 3 and a triplet eighth 4, both whole numbers. */
const DIVISIONS_PER_UNIT = 3;

const CHORD_KINDS: Record<string, string> = {
  '': 'major',
  m: 'minor',
  min: 'minor',
  '7': 'dominant',
  maj7: 'major-seventh',
  M7: 'major-seventh',
  m7: 'minor-seventh',
  min7: 'minor-seventh',
  '6': 'major-sixth',
  m6: 'minor-sixth',
  dim: 'diminished',
  dim7: 'diminished-seventh',
  m7b5: 'half-diminished',
  aug: 'augmented',
  '+': 'augmented',
  sus4: 'suspended-fourth',
  sus2: 'suspended-second',
  '9': 'dominant-ninth',
};

/** A chord symbol as a <harmony>, or as plain words above the staff if it is not one this understands. */
function chordXml(chord: string): string {
  const parts = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(chord.trim());
  if (!parts) {
    return [
      '      <direction placement="above">',
      '        <direction-type>',
      `          <words>${escapeXml(chord)}</words>`,
      '        </direction-type>',
      '      </direction>',
    ].join('\n');
  }
  const [, step, acc, kind, bassStep, bassAcc] = parts;
  const alter = (a: string) => (a === '#' ? 1 : a === 'b' ? -1 : 0);
  const lines = ['      <harmony>', '        <root>', `          <root-step>${step}</root-step>`];
  if (acc) lines.push(`          <root-alter>${alter(acc)}</root-alter>`);
  lines.push('        </root>');
  lines.push(`        <kind text="${escapeXml(kind)}">${CHORD_KINDS[kind] ?? 'other'}</kind>`);
  if (bassStep) {
    lines.push('        <bass>', `          <bass-step>${bassStep}</bass-step>`);
    if (bassAcc) lines.push(`          <bass-alter>${alter(bassAcc)}</bass-alter>`);
    lines.push('        </bass>');
  }
  lines.push('      </harmony>');
  return lines.join('\n');
}

/**
 * @param tupletEdge   for a tuplet note, whether it opens or closes its triplet
 * @param midWord      whether the syllable before this one ended in a hyphen
 */
function noteXml(
  item: ScoreItem,
  tiedFromPrevious: boolean,
  tupletEdge: 'start' | 'stop' | null,
  midWord: boolean,
): string {
  const lines: string[] = item.chord ? [chordXml(item.chord), '      <note>'] : ['      <note>'];
  if (item.kind === 'rest' || !item.pitch) {
    lines.push(item.wholeBar ? '        <rest measure="yes"/>' : '        <rest/>');
  } else {
    const alter = ACC_OFFSET[item.pitch.acc];
    lines.push('        <pitch>');
    lines.push(`          <step>${item.pitch.letter}</step>`);
    if (alter !== 0) lines.push(`          <alter>${alter}</alter>`);
    lines.push(`          <octave>${item.pitch.octave}</octave>`);
    lines.push('        </pitch>');
  }
  lines.push(`        <duration>${Math.round(item.units * DIVISIONS_PER_UNIT)}</duration>`);
  if (tiedFromPrevious) lines.push('        <tie type="stop"/>');
  if (item.tieToNext) lines.push('        <tie type="start"/>');
  lines.push('        <voice>1</voice>');
  if (!item.wholeBar) {
    lines.push(`        <type>${TYPE_NAMES[item.duration]}</type>`);
    if (item.dotted) lines.push('        <dot/>');
  }
  if (item.tuplet) {
    lines.push(
      '        <time-modification>',
      '          <actual-notes>3</actual-notes>',
      '          <normal-notes>2</normal-notes>',
      '        </time-modification>',
    );
  }
  if (tiedFromPrevious || item.tieToNext || tupletEdge) {
    lines.push('        <notations>');
    if (tiedFromPrevious) lines.push('          <tied type="stop"/>');
    if (item.tieToNext) lines.push('          <tied type="start"/>');
    if (tupletEdge) lines.push(`          <tuplet type="${tupletEdge}"/>`);
    lines.push('        </notations>');
  }
  if (item.lyric) {
    const carriesOn = item.lyric.endsWith('-');
    const syllabic = midWord ? (carriesOn ? 'middle' : 'end') : carriesOn ? 'begin' : 'single';
    lines.push(
      '        <lyric number="1">',
      `          <syllabic>${syllabic}</syllabic>`,
      `          <text>${escapeXml(item.lyric.replace(/-$/, ''))}</text>`,
      '        </lyric>',
    );
  }
  lines.push('      </note>');
  return lines.join('\n');
}

export function toMusicXml(score: Score, title: string): string {
  const { meter, key, clef, bpm } = score;
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    '  <work>',
    `    <work-title>${escapeXml(title)}</work-title>`,
    '  </work>',
    '  <identification>',
    '    <encoding>',
    '      <software>Tune Scribe</software>',
    `      <encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date>`,
    '    </encoding>',
    '  </identification>',
    '  <part-list>',
    '    <score-part id="P1">',
    '      <part-name>Melody</part-name>',
    '    </score-part>',
    '  </part-list>',
    '  <part id="P1">',
  ];

  let tied = false;
  let midWord = false;
  score.measures.forEach((measure, index) => {
    out.push(`    <measure number="${index + 1}">`);
    if (index === 0) {
      out.push(
        '      <attributes>',
        `        <divisions>${4 * DIVISIONS_PER_UNIT}</divisions>`,
        '        <key>',
        `          <fifths>${signatureCount(key)}</fifths>`,
        `          <mode>${key.mode}</mode>`,
        '        </key>',
        '        <time>',
        `          <beats>${meter.beats}</beats>`,
        `          <beat-type>${meter.beatValue}</beat-type>`,
        '        </time>',
        '        <clef>',
        `          <sign>${clef === 'bass' ? 'F' : 'G'}</sign>`,
        `          <line>${clef === 'bass' ? 4 : 2}</line>`,
        '        </clef>',
        '      </attributes>',
        '      <direction placement="above">',
        '        <direction-type>',
        '          <metronome>',
        '            <beat-unit>quarter</beat-unit>',
        `            <per-minute>${bpm}</per-minute>`,
        '          </metronome>',
        '        </direction-type>',
        `        <sound tempo="${bpm}"/>`,
        '      </direction>',
      );
      if (score.swing) {
        out.push(
          '      <direction placement="above">',
          '        <direction-type>',
          '          <words>Swing</words>',
          '        </direction-type>',
          '      </direction>',
        );
      }
    }
    /** how much of the current triplet's beat has been written, in units */
    let inTriplet = 0;
    for (const item of measure.items) {
      let edge: 'start' | 'stop' | null = null;
      if (item.tuplet) {
        if (inTriplet === 0) edge = 'start';
        inTriplet += item.units;
        if (inTriplet > 4 - 1e-6) {
          edge = 'stop';
          inTriplet = 0;
        }
      }
      out.push(noteXml(item, tied, edge, midWord));
      if (item.lyric) midWord = item.lyric.endsWith('-');
      tied = item.kind === 'note' && !!item.tieToNext;
    }
    if (index === score.measures.length - 1) {
      out.push('      <barline location="right">', '        <bar-style>light-heavy</bar-style>', '      </barline>');
    }
    out.push('    </measure>');
  });

  out.push('  </part>', '</score-partwise>', '');
  return out.join('\n');
}
