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

function noteXml(item: ScoreItem, tiedFromPrevious: boolean): string {
  const lines: string[] = ['      <note>'];
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
  // divisions = 4 per quarter, so a duration is simply the length in sixteenths
  lines.push(`        <duration>${item.units}</duration>`);
  if (tiedFromPrevious) lines.push('        <tie type="stop"/>');
  if (item.tieToNext) lines.push('        <tie type="start"/>');
  lines.push('        <voice>1</voice>');
  if (!item.wholeBar) {
    lines.push(`        <type>${TYPE_NAMES[item.duration]}</type>`);
    if (item.dotted) lines.push('        <dot/>');
  }
  if (tiedFromPrevious || item.tieToNext) {
    lines.push('        <notations>');
    if (tiedFromPrevious) lines.push('          <tied type="stop"/>');
    if (item.tieToNext) lines.push('          <tied type="start"/>');
    lines.push('        </notations>');
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
  score.measures.forEach((measure, index) => {
    out.push(`    <measure number="${index + 1}">`);
    if (index === 0) {
      out.push(
        '      <attributes>',
        '        <divisions>4</divisions>',
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
    }
    for (const item of measure.items) {
      out.push(noteXml(item, tied));
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
