// Adapted from purrfect-pitch (src/components/ScoreView.tsx): the same
// ResizeObserver-driven width and theme-aware re-render, around the
// multi-system renderer.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ScoreHandle } from '../notation/renderScore';
import { renderScore, staffInkFrom } from '../notation/renderScore';
import { useTheme } from '../theme';
import type { Score } from '../transcribe/score';

interface Props {
  score: Score;
  /** index of the played note to highlight, during playback */
  activeEvent: number | null;
  /** what is picked for editing: played notes by index, or a rest by its id */
  selected: number[];
  /** a note or rest was tapped (its index or id; with shift held, `extend`), or the score beside them (null) */
  onSelect: (id: number | null, extend: boolean) => void;
}

/** Width the score is re-set at for paper: fits the printable width of A4 and Letter at 96 px/inch. Matches .sheet in the print stylesheet. */
const PRINT_WIDTH = 660;

export default function ScoreView({ score, activeEvent, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ScoreHandle | null>(null);
  const [width, setWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [printing, setPrinting] = useState(false);
  // re-render the staff in the new ink when the theme changes
  const { resolved: theme } = useTheme();

  // VexFlow registers its music and text fonts when the module loads; glyph
  // metrics are wrong until they have arrived, so hold the first render for them
  useEffect(() => {
    let alive = true;
    const done = () => {
      if (alive) setFontsReady(true);
    };
    Promise.all([document.fonts.load('30px Bravura'), document.fonts.load('12px Academico')]).then(done, done);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A phone-width score would print as a narrow column. Lay it out again at
  // page width just before the browser takes its print snapshot; flushSync
  // because the snapshot is taken as soon as the event handler returns.
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const renderWidth = printing ? PRINT_WIDTH : width;

  // layout effects, so the print re-render above is on the page before flushSync returns
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el || renderWidth === 0 || !fontsReady) return;
    handleRef.current = renderScore(el, score, renderWidth, staffInkFrom(el));
  }, [score, renderWidth, theme, fontsReady]);

  useLayoutEffect(() => {
    handleRef.current?.setActive(printing ? null : activeEvent);
  }, [activeEvent, score, renderWidth, theme, fontsReady, printing]);

  useLayoutEffect(() => {
    handleRef.current?.setSelected(printing ? [] : selected);
  }, [selected, score, renderWidth, theme, fontsReady, printing]);

  return (
    <div ref={wrapRef} className="score-view">
      <div
        ref={canvasRef}
        className="score-canvas"
        data-testid="score"
        onClick={(e) => {
          const note = (e.target as Element).closest('[data-event]');
          onSelect(note ? Number(note.getAttribute('data-event')) : null, e.shiftKey);
        }}
      />
    </div>
  );
}
