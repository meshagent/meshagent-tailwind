export default {
    content: [
        './src/**/*.{js,jsx,ts,tsx}',
        '../src/*.{js,jsx,ts,tsx}',
    ],
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
    plugins: [
        require('@tailwindcss/typography'),
        require('@tailwindcss/forms'),
        require('@tailwindcss/aspect-ratio'),
    ],
    corePlugins: {
        preflight: false,
    },
    darkMode: 'class',
}
