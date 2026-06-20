// Two flat palettes, mirroring the web app's light ("cozy") and dark themes.
// Screens read colors from the active palette so the toggle recolors everything
// without per-component conditionals.

export const THEMES = {
  light: {
    name: 'light',
    bg: '#ffffff',
    surface: '#fafafa',
    fg: '#1a1a1a',
    muted: '#666666',
    muted2: '#999999',
    line: '#e3e3e3',
    accent: '#1f6feb', // primary action
    green: '#15803d', // "got it" / selected / staying — deep enough for white text
    amber: '#b56b00', // active phrase border
  },
  dark: {
    name: 'dark',
    bg: '#0f1115',
    surface: '#1a1d24',
    fg: '#f2f3f5',
    muted: '#9aa0aa',
    muted2: '#6b7280',
    line: '#2a2e37',
    accent: '#4a8bf0',
    green: '#34c77b',
    amber: '#e0a33a',
  },
};

export function paletteFor(themeName) {
  return THEMES[themeName] ?? THEMES.light;
}
