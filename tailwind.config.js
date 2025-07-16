/**  @type {import('tailwindcss').Config}  */
module.exports = {
  /**
   * 1)  Tell Tailwind which *library* files contain class names.
   *     ⚠️  Do **not** point at the consuming app here – the app
   *     will run its own Tailwind build (or simply import the CSS
   *     you generate).  Scanning only your sources keeps the
   *     build fast and prevents “purge” from stripping classes
   *     the host never uses.
   */
  content: [
    './src/**/*.{js,ts,jsx,tsx}',           // components
  ],

  /**
   * 2)  Library‑specific design tokens live here.  Extend instead
   *     of replace so consumers can theme on top.
   */
  theme: {
    extend: {
      colors: {
        /* brand palette example */
        brand: {
          50:  '#f2f8ff',
          100: '#d0e4ff',
          200: '#a4cbff',
          300: '#76b1ff',
          400: '#4a99ff',
          500: '#297fff',
          600: '#1264e9',
          700: '#0c4bc0',
          800: '#073396',
          900: '#041f6d',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },

  /**
   * 3)  Plugins your *library* needs.  Consumers do not have to
   *     install them as dev‑deps when they only import `dist/index.css`.
   */
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('@tailwindcss/aspect-ratio'),
  ],

  /**
   * 4)  Optional: turn off Preflight so your CSS cannot clobber the
   *     host application’s base styles.  Keep it *on* if components
   *     rely on Tailwind’s base.
   */
  corePlugins: {
    preflight: false,
  },

  /**
   * 5)  Choose whichever dark‑mode strategy your components follow.
   *     Class‑based is safest for libraries.
   */
  darkMode: 'class',
};
