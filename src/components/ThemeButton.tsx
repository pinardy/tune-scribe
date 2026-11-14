import { useTheme, type ThemePreference } from '../theme';

// drawn rather than typed: the ◐ ☀ ☾ characters are missing from some system fonts
const THEME_ICON: Record<ThemePreference, JSX.Element> = {
  system: (
    <>
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="10" cy="10" r="3.6" fill="currentColor" />
      <path
        d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  dark: <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z" fill="currentColor" />,
};
const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Theme: follows the system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export default function ThemeButton() {
  const { preference, cycle } = useTheme();
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`${THEME_LABEL[preference]}. Change theme`}
      title={THEME_LABEL[preference]}
      onClick={cycle}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        {THEME_ICON[preference]}
      </svg>
    </button>
  );
}
