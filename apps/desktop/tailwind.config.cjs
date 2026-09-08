/**
 * Tailwind configuration.
 *
 * COLOR CONVENTION - read before adding classes.
 *
 * Every colour token below resolves to a CSS custom property defined in
 * src/ui/styles/themes.css, so the same class works in light, dark and sepia.
 * Do NOT use Tailwind's fixed palette (bg-white, bg-gray-100, text-gray-700,
 * border-gray-300 ...) for UI chrome - those are frozen to the light theme and
 * are what made dark mode unreadable. Pick the token that matches the ROLE:
 *
 *   Page / pane backgrounds ... bg-background            (bg-background-warm,
 *                                                         -secondary, -tertiary)
 *   Hover / active states .... bg-background-hover, bg-background-active
 *   Modal scrims ............. bg-background-overlay
 *   Cards, dialogs, popovers . bg-surface, bg-surface-secondary,
 *                              bg-surface-elevated (floating above everything)
 *   Body text ................ text-text-primary / -secondary / -muted
 *   Headings ................. text-text-heading
 *   Text on a coloured fill .. text-text-on-accent
 *   Hairlines ................ border-border, border-border-secondary
 *   Primary action ........... bg-accent + text-text-on-accent
 *   Selected / tinted state .. bg-accent-light, bg-accent-soft,
 *                              text-accent-strong (legible on those tints)
 *   Secondary button ......... bg-control hover:bg-control-hover text-control-text
 *   Form fields .............. bg-input border-input-border
 *   Status ................... {danger,success,warning,info} +
 *                              -soft (fill), -text, -border
 *
 * The underlying variables are declared as `R G B` triplets, so Tailwind
 * opacity modifiers work on all of these (e.g. `bg-accent/10`).
 */

/** Build a Tailwind colour that supports opacity modifiers. */
const themeColor = (name) => `rgb(var(--theme-${name}-rgb) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/ui/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        // Serif fonts for Bible text
        'bible': ['Georgia', 'Merriweather', 'serif'],
        // Sans-serif for UI
        'sans': ['Inter', 'system-ui', 'sans-serif']
      },
      fontSize: {
        'bible': ['20px', { lineHeight: '1.75' }]
      },
      colors: {
        // --- Page / pane backgrounds ---
        background: {
          DEFAULT: themeColor('bg-primary'),
          primary: themeColor('bg-primary'),
          // `warm` is the historical name for the secondary page background
          warm: themeColor('bg-secondary'),
          secondary: themeColor('bg-secondary'),
          tertiary: themeColor('bg-tertiary'),
          hover: themeColor('bg-hover'),
          active: themeColor('bg-active'),
          strong: themeColor('bg-strong'),
          // Modal scrim; alpha is baked into the variable
          overlay: 'var(--theme-bg-overlay)'
        },

        // --- Cards / dialogs / popovers ---
        surface: {
          DEFAULT: themeColor('surface-primary'),
          primary: themeColor('surface-primary'),
          secondary: themeColor('surface-secondary'),
          elevated: themeColor('surface-elevated')
        },

        // --- Text ---
        text: {
          DEFAULT: themeColor('text-primary'),
          primary: themeColor('text-primary'),
          body: themeColor('text-primary'),
          secondary: themeColor('text-secondary'),
          tertiary: themeColor('text-muted'),
          muted: themeColor('text-muted'),
          heading: themeColor('text-heading'),
          inverse: themeColor('text-inverse'),
          'on-accent': themeColor('accent-text')
        },

        // --- Accent / primary action ---
        accent: {
          DEFAULT: themeColor('accent-primary'),
          hover: themeColor('accent-hover'),
          // Readable accent-coloured text on accent-light/-soft fills
          strong: themeColor('accent-strong'),
          text: themeColor('accent-text'),
          // Tinted fills (alpha baked in)
          light: 'var(--theme-accent-light)',
          soft: 'var(--theme-accent-soft)'
        },

        // --- Borders ---
        border: {
          DEFAULT: themeColor('border-primary'),
          primary: themeColor('border-primary'),
          secondary: themeColor('border-secondary'),
          strong: themeColor('bg-strong'),
          focus: themeColor('border-focus')
        },

        // --- Form fields ---
        input: {
          DEFAULT: themeColor('input-bg'),
          bg: themeColor('input-bg'),
          border: themeColor('input-border'),
          text: themeColor('input-text'),
          placeholder: themeColor('input-placeholder')
        },

        // --- Neutral / secondary buttons ---
        control: {
          DEFAULT: themeColor('control-bg'),
          hover: themeColor('control-hover'),
          text: themeColor('control-text')
        },

        // --- Status ---
        danger: {
          DEFAULT: themeColor('danger'),
          hover: themeColor('danger-hover'),
          soft: themeColor('danger-soft'),
          text: themeColor('danger-text'),
          border: themeColor('danger-border')
        },
        success: {
          DEFAULT: themeColor('success'),
          soft: themeColor('success-soft'),
          text: themeColor('success-text'),
          border: themeColor('success-border')
        },
        warning: {
          DEFAULT: themeColor('warning'),
          soft: themeColor('warning-soft'),
          text: themeColor('warning-text'),
          border: themeColor('warning-border')
        },
        info: {
          DEFAULT: themeColor('info'),
          soft: themeColor('info-soft'),
          text: themeColor('info-text'),
          border: themeColor('info-border')
        },

        // Christ's words (red letter)
        christ: themeColor('christ'),

        // Annotation highlight swatches (same hue in every theme)
        highlight: {
          yellow: themeColor('highlight-yellow'),
          green: themeColor('highlight-green'),
          blue: themeColor('highlight-blue'),
          red: themeColor('highlight-red'),
          purple: themeColor('highlight-purple'),
          orange: themeColor('highlight-orange')
        }
      },
      // Tailwind's preflight paints every element's default border colour from
      // borderColor.DEFAULT (normally the fixed gray-200). Point it at the theme
      // so a bare `border` class is theme-aware too.
      borderColor: {
        DEFAULT: themeColor('border-primary')
      },
      ringColor: {
        DEFAULT: themeColor('accent-primary')
      },
      spacing: {
        'xs': '4px',
        'sm': '8px',
        'md': '16px',
        'lg': '24px',
        'xl': '32px',
        'xxl': '48px'
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
};
