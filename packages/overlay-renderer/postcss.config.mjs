// Required by @remotion/tailwind-v4: it wires a bare postcss-loader into the
// bundle and relies on this config to load the Tailwind v4 PostCSS plugin.
// Without it, `@import "tailwindcss"` is never expanded into utility classes
// and every caption/CTA style is silently dropped.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
