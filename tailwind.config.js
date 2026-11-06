/** @type {import('tailwindcss').Config} */
// Design tokens. Colors resolve to CSS variables declared in src/index.css so the
// accent preference (Settings → Appearance) can change them at runtime.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("c-bg"),
        chrome: v("c-chrome"),
        panel: v("c-panel"),
        raised: v("c-raised"),
        control: { DEFAULT: v("c-control"), hover: v("c-control-hover"), active: v("c-control-active") },
        line: v("c-line"),
        accent: { DEFAULT: v("c-accent"), hover: v("c-accent-hover"), dim: v("c-accent-dim"), ink: v("c-accent-ink") },
        ink: { DEFAULT: v("c-ink"), muted: v("c-ink-muted"), faint: v("c-ink-faint") },
        brand: v("c-brand"),
        danger: v("c-danger"),
        ok: v("c-ok"),
        warn: v("c-warn"),
      },
      fontFamily: {
        // The per-language stack is chosen in index.css via :lang(); this is the default.
        sans: ["var(--font-ui)"],
        mono: ["ui-monospace", "Cascadia Mono", "Consolas", "monospace"],
      },
      // Corner radius slider (Settings -> Appearance): --r-scale is 1 at the default radius of 12.
      borderRadius: {
        sm: "calc(0.125rem * var(--r-scale, 1))",
        DEFAULT: "calc(0.25rem * var(--r-scale, 1))",
        md: "calc(0.375rem * var(--r-scale, 1))",
        lg: "calc(0.5rem * var(--r-scale, 1))",
        xl: "calc(0.75rem * var(--r-scale, 1))",
        "2xl": "calc(1rem * var(--r-scale, 1))",
        "3xl": "calc(1.5rem * var(--r-scale, 1))",
      },
      boxShadow: {
        card: "0 14px 40px rgba(0,0,0,.18)",
        pop: "0 24px 60px rgba(0,0,0,.55)",
        dialog: "0 24px 80px rgba(0,0,0,.6)",
        accent: "0 8px 28px -10px rgb(var(--c-accent) / .75)",
      },
      zIndex: { dropdown: "40", overlay: "50", dialog: "60", toast: "70" },
      transitionDuration: { DEFAULT: "150ms" },
    },
  },
  plugins: [],
};
