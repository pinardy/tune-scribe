// Button glyphs, drawn on the same 20-unit grid as the theme icons.

const ICON = {
  play: <path d="M6.5 4.2v11.6l9.3-5.8z" fill="currentColor" />,
  stop: <rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" />,
  open: <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 16h12" />,
  save: <path d="M10 3.5v9m0 0L6.5 9M10 12.5 13.5 9M4 16h12" />,
  share: <path d="M10 12.5V3m0 0L6.8 6.2M10 3l3.2 3.2M5.5 9.5H4.8A1.3 1.3 0 0 0 3.5 10.8v5A1.3 1.3 0 0 0 4.8 17h10.4a1.3 1.3 0 0 0 1.3-1.2v-5a1.3 1.3 0 0 0-1.3-1.3h-.7" />,
  print: (
    <path d="M6 7V3.5h8V7M6 14H4.5A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7h11A1.5 1.5 0 0 1 17 8.5v4a1.5 1.5 0 0 1-1.5 1.5H14M6 11.5h8v5H6z" />
  ),
  up: <path d="M10 16V4.5m0 0L5.5 9M10 4.5 14.5 9" />,
  down: <path d="M10 4v11.5m0 0L5.5 11m4.5 4.5 4.5-4.5" />,
  minus: <path d="M4.5 10h11" />,
  plus: <path d="M4.5 10h11M10 4.5v11" />,
  previous: <path d="M12.5 4.5 7 10l5.5 5.5" />,
  next: <path d="M7.5 4.5 13 10l-5.5 5.5" />,
  link: <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />,
  undo: <path d="M7 4.5 3.5 8 7 11.5M3.5 8h8a4.5 4.5 0 0 1 0 9H8" />,
  redo: <path d="M13 4.5 16.5 8 13 11.5M16.5 8h-8a4.5 4.5 0 0 0 0 9H12" />,
  remove: <path d="M4 6h12M8 6V4h4v2M5.5 6l.7 10h7.6l.7-10M8.5 9v4.5M11.5 9v4.5" />,
};

export type IconName = keyof typeof ICON;

export default function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON[name]}
    </svg>
  );
}
