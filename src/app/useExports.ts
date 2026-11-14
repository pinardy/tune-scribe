// Taking the tune away: PDF, the share sheet, MusicXML, MIDI, and a link.

import { useMemo, useState } from 'react';
import { downloadFile, fileStem } from '../export/download';
import { toMidi } from '../export/midi';
import { toMusicXml } from '../export/musicxml';
import { keyLabel } from '../notation/theory';
import { LINK_PREFIX, MAX_LINK_LENGTH, encodeTune } from '../share/link';
import type { StoredTake } from '../storage/library';
import type { Marks } from '../transcribe/marks';
import type { Score } from '../transcribe/score';
import type { ScribeSettings } from '../transcribe/settings';
import { UNTITLED } from './format';

interface Options {
  score: Score | undefined;
  take: StoredTake | null;
  title: string;
  composer: string;
  settings: ScribeSettings;
  marks: Marks;
  onError: (message: string | null) => void;
  onNotice: (message: string) => void;
}

export interface Exports {
  /** a PDF is being made */
  busy: boolean;
  /** whether the browser's share sheet takes files (phones do; most desktops don't) */
  shareable: boolean;
  savePdf: () => Promise<void>;
  share: () => Promise<void>;
  saveMusicXml: () => void;
  saveMidi: () => void;
  copyLink: () => Promise<void>;
}

function canShareFiles(): boolean {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'tune.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

export function useExports({ score, take, title, composer, settings, marks, onError, onNotice }: Options): Exports {
  const [busy, setBusy] = useState(false);
  const shareable = useMemo(canShareFiles, []);
  const name = title.trim() || UNTITLED;
  const by = composer.trim();

  const makePdf = async (of: Score) => {
    // the PDF is drawn with VexFlow: the notation chunk
    const { scorePdf } = await import('../export/scorePdf');
    return scorePdf(of, name, keyLabel(of.key), by);
  };

  const savePdf = async () => {
    if (!score || busy) return;
    setBusy(true);
    try {
      downloadFile(`${fileStem(name)}.pdf`, await makePdf(score), 'application/pdf');
    } catch {
      onError('The PDF could not be made. Print the score instead and choose “Save as PDF”.');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!score || busy) return;
    setBusy(true);
    try {
      const pdf = await makePdf(score);
      const file = new File([pdf], `${fileStem(name)}.pdf`, { type: 'application/pdf' });
      try {
        await navigator.share({ files: [file], title: name });
      } catch (err) {
        // closing the share sheet is not a failure; a refusal to open it falls back to a download
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          downloadFile(file.name, pdf, 'application/pdf');
        }
      }
    } catch {
      onError('The score could not be shared. Try saving it as a PDF instead.');
    } finally {
      setBusy(false);
    }
  };

  const saveMusicXml = () => {
    if (!score) return;
    downloadFile(`${fileStem(name)}.musicxml`, toMusicXml(score, name, by), 'application/vnd.recordare.musicxml+xml');
  };

  const saveMidi = () => {
    if (score) downloadFile(`${fileStem(name)}.mid`, toMidi(score, name), 'audio/midi');
  };

  const copyLink = async () => {
    if (!take) return;
    onError(null);
    const payload = await encodeTune({
      title: name,
      composer: by,
      notes: take.heard.notes,
      settings,
      marks,
      clickBpm: take.clickBpm,
    });
    const link = `${location.origin}${location.pathname}${LINK_PREFIX}${payload}`;
    if (link.length > MAX_LINK_LENGTH) {
      onError('This tune is too long to fit in a link. Share the PDF or the MusicXML file instead.');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      onNotice('Link copied. It opens this score, without the recording, in Tune Scribe.');
    } catch {
      // no clipboard here: hand the link over in a box it can be copied from
      window.prompt('Copy this link:', link);
    }
  };

  return { busy, shareable, savePdf, share, saveMusicXml, saveMidi, copyLink };
}
