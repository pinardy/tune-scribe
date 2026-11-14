// Ported unchanged from purrfect-pitch (src/theme.tsx) apart from the storage key and chrome colours.
// Colour theme: follows the system setting by default, with a manual
// override that is remembered. The resolved theme is applied as a
// `data-theme` attribute on <html>, which the stylesheet keys its variables
// on, and mirrored into the browser-chrome theme colour.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

// prefixed: apps served from one origin (e.g. several GitHub Pages projects) share localStorage
const STORAGE_KEY = 'scribe.theme';
const PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

/** Browser-chrome colour matching the page background of each theme. */
const CHROME_COLOR: Record<ResolvedTheme, string> = { light: '#f3f5f1', dark: '#10182a' };

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** system → light → dark → system */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return PREFERENCES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Pins the stylesheet's theme variables, or releases them to the system setting. */
function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(loadPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? system : preference;

  useEffect(() => {
    applyPreference(preference);
    const root = document.documentElement;
    root.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME_COLOR[resolved]);
  }, [preference, resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    // before the re-render, not in the effect above: children's effects run
    // first, and the score reads its ink from the CSS variables in theirs
    applyPreference(next);
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable — the choice just won't persist
    }
  }, []);

  const cycle = useCallback(() => {
    setPreference(PREFERENCES[(PREFERENCES.indexOf(preference) + 1) % PREFERENCES.length]);
  }, [preference, setPreference]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, cycle }),
    [preference, resolved, setPreference, cycle],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
