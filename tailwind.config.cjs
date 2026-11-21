const dynamicColors = [
    'slate',
    'gray',
    'zinc',
    'neutral',
    'stone',
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'violet',
    'purple',
    'fuchsia',
    'pink',
    'rose'
];

// Each family reads the active Astryx palette theme (themes/shared/legacyBridge.ts):
// --cl-<family>-<shade> holds "R G B" channels, so opacity modifiers keep working.
const family = (name) =>
    Object.fromEntries(
        ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].map((shade) => [
            shade,
            `rgb(var(--cl-${name}-${shade}) / <alpha-value>)`
        ])
    );

const neutral = family('neutral');
const accent = family('accent');
const info = family('info');
const success = family('success');
const warning = family('warning');
const danger = family('danger');

const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const alphaSuffixes = ['/5', '/10', '/20', '/30', '/40', '/50', '/60'];
const variants = ['dark', 'hover', 'focus', 'focus-visible', 'disabled'];

const colorUtilities = dynamicColors.flatMap((color) => {
    const solidUtilities = shades.flatMap((shade) => [
        `bg-${color}-${shade}`,
        `text-${color}-${shade}`,
        `border-${color}-${shade}`,
        `ring-${color}-${shade}`,
        `shadow-${color}-${shade}`,
        `from-${color}-${shade}`,
        `via-${color}-${shade}`,
        `to-${color}-${shade}`
    ]);

    const alphaUtilities = alphaSuffixes.flatMap((suffix) => [
        `bg-${color}-500${suffix}`,
        `border-${color}-500${suffix}`,
        `ring-${color}-500${suffix}`,
        `shadow-${color}-500${suffix}`,
        `ring-${color}-400${suffix}`
    ]);

    return [...solidUtilities, ...alphaUtilities];
});

const variantUtilities = variants.flatMap((variant) => colorUtilities.map((utility) => `${variant}:${utility}`));

module.exports = {
    darkMode: 'class',
    content: [
        './index.html',
        './src/**/*.{js,jsx,html}'
    ],
    safelist: [
        ...colorUtilities,
        ...variantUtilities,
        'bg-white',
        'text-white',
        'border-white',
        'bg-black',
        'text-black',
        'border-black',
        'bg-transparent',
        'text-transparent',
        'border-transparent'
    ],
    theme: {
        colors: {
            inherit: 'inherit',
            current: 'currentColor',
            transparent: 'transparent',
            black: 'rgb(var(--cl-black) / <alpha-value>)',
            white: 'rgb(255 255 255 / <alpha-value>)',
            slate: neutral,
            gray: neutral,
            zinc: neutral,
            neutral,
            stone: neutral,
            lime: accent,
            indigo: accent,
            violet: accent,
            purple: accent,
            fuchsia: accent,
            blue: info,
            sky: info,
            cyan: info,
            emerald: success,
            green: success,
            teal: success,
            amber: warning,
            yellow: warning,
            orange: warning,
            red: danger,
            rose: danger,
            pink: danger
        },
        // Type and corners come from the Astryx theme too.
        fontFamily: {
            sans: ['var(--font-family-body)'],
            display: ['var(--font-family-heading)'],
            mono: ['var(--font-family-code)']
        },
        borderRadius: {
            none: '0px',
            sm: '4px',
            DEFAULT: 'var(--radius-inner)',
            md: 'var(--radius-inner)',
            lg: 'var(--radius-element)',
            xl: 'var(--radius-container)',
            '2xl': 'var(--radius-container)',
            '3xl': 'calc(var(--radius-container) * 1.5)',
            full: '9999px'
        },
        extend: {}
    }
};
