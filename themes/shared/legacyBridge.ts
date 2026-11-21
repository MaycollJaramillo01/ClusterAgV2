// Shared by the five Cluster palette themes (cluster, marea, musgo, buganvilla, grafito).
// The app still carries Tailwind color classes and main.css rules written for the old
// look. This file points both at the active Astryx theme, so every screen follows the
// palette the user picks, in light and dark:
//   - Tailwind families read --cl-<family>-<shade> as "R G B" channels
//     (tailwind.config.cjs: rgb(var(--cl-neutral-500) / <alpha-value>)).
//   - The old main.css names (--canvas, --text, --primary...) alias Astryx tokens.

type Ramp = Record<string, string>;
type Palette = Record<string, {light: Ramp; dark: Ramp}>;

// Tailwind shade -> Astryx stop (0 black ... 100 white). 50 sits between 95 and 100.
const STOPS: Record<string, number> = {
  100: 95, 200: 90, 300: 80, 400: 60, 500: 45,
  600: 35, 700: 25, 800: 20, 900: 15, 950: 10,
};

const channels = (hex: string): number[] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

const families = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'];

export const legacyBridge = (palette: Palette): Record<string, string> => {
  const tokens: Record<string, string> = {};
  for (const family of families) {
    const ramp = palette[family].light;
    const [r1, g1, b1] = channels(ramp[95]);
    tokens[`--cl-${family}-50`] = [r1, g1, b1].map((c) => Math.round((c + 255) / 2)).join(' ');
    for (const [shade, stop] of Object.entries(STOPS)) {
      tokens[`--cl-${family}-${shade}`] = channels(ramp[stop]).join(' ');
    }
  }
  tokens['--cl-black'] = channels(palette.neutral.light[5]).join(' ');
  tokens['--shadow-color'] = channels(palette.neutral.light[5]).join(', ');

  return {
    ...tokens,
    // Surfaces
    '--canvas': 'var(--color-background-body)',
    '--surface': 'var(--color-background-surface)',
    '--surface-raised': 'var(--color-background-surface)',
    '--surface-subtle': 'color-mix(in oklab, var(--color-background-surface) 55%, var(--color-background-body))',
    '--surface-muted': 'color-mix(in oklab, var(--color-text-primary) 6%, var(--color-background-surface))',
    '--surface-overlay': 'var(--color-overlay)',
    // Text
    '--text': 'var(--color-text-primary)',
    '--text-muted': 'var(--color-text-secondary)',
    '--text-faint': 'var(--color-icon-secondary)',
    // Lines
    '--border': 'var(--color-border)',
    '--border-strong': 'var(--color-border-emphasized)',
    // Actions are ink; the accent marks results, progress and focus.
    '--primary': 'var(--color-text-primary)',
    '--primary-hover': 'color-mix(in oklab, var(--color-text-primary) 84%, var(--color-background-surface))',
    '--primary-soft': 'var(--color-neutral)',
    '--primary-contrast': 'var(--color-background-surface)',
    '--color-primary': 'var(--primary)',
    '--color-primary-hover': 'var(--primary-hover)',
    '--accent': 'var(--color-accent)',
    '--accent-soft': 'var(--color-accent-muted)',
    '--accent-text': 'var(--color-text-accent)',
    '--focus': 'var(--focus-outline-color)',
    // Status
    '--status-red-bg': 'var(--color-error-muted)',
    '--status-red-text': 'var(--color-text-error)',
    '--status-blue-bg': 'var(--color-info-muted)',
    '--status-blue-text': 'var(--color-text-info)',
    '--status-green-bg': 'var(--color-success-muted)',
    '--status-green-text': 'var(--color-text-success)',
    '--status-yellow-bg': 'var(--color-warning-muted)',
    '--status-yellow-text': 'var(--color-text-warning)',
    // Type
    '--font-display': 'var(--font-family-heading)',
  };
};
