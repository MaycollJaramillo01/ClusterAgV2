(() => {
    const version = '2026-07-performance-focus';
    const versionKey = 'cluster_theme_default_version';
    const themeKey = 'cluster_theme';
    const paletteKey = 'cluster_palette';
    // The five Astryx palette themes (src/astryx-themes.js). Older ids map to the nearest new one.
    const palettes = ['cluster', 'marea', 'musgo', 'buganvilla', 'grafito'];
    const legacyPalettes = { cobalt: 'marea', clay: 'marea', plum: 'buganvilla' };
    if (!localStorage.getItem(themeKey)) {
        localStorage.setItem(themeKey, 'dark');
    }
    localStorage.setItem(versionKey, version);
    const storedPalette = localStorage.getItem(paletteKey);
    const palette = palettes.includes(storedPalette)
        ? storedPalette
        : legacyPalettes[storedPalette] || 'cluster';
    localStorage.setItem(paletteKey, palette);
    const isDark = localStorage.getItem(themeKey) !== 'light';
    const html = document.documentElement;
    // Same attributes the root Astryx <Theme> keeps in sync, set before the first paint.
    html.dataset.astryxTheme = palette;
    html.dataset.theme = isDark ? 'dark' : 'light';
    html.classList.toggle('dark', isDark);
})();
