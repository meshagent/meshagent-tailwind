import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from "url"

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ],
    css: {
        postcss: './postcss.config.js',
    },
    optimizeDeps: {
        include: [
            '@meshagent/meshagent',
            '@meshagent/meshagent-react',
            '@meshagent/meshagent-tailwind',
        ],
    },
    resolve: {
        preserveSymlinks: true,
        dedupe: [
            '@meshagent/meshagent'
        ],
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
});
