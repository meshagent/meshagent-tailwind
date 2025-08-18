import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from "url"

export default defineConfig({
    server: {
        watch: {
            usePolling: true,        // especially on Docker/WSL
            interval: 100,
            ignored: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/data/**',
                '**/test_support/**',
                '**/tests/**',
                '**/venv/**',
            ]
        }
    },
    plugins: [
        react(),
        tailwindcss(),
    ],
    css: {
        postcss: './postcss.config.js',
    },
    optimizeDeps: {
        exclude: [
            '@meshagent/meshagent',
            '@meshagent/meshagent-react',
            '@meshagent/meshagent-tailwind',
        ],
    },
    resolve: {
        preserveSymlinks: true,
        dedupe: [
            '@meshagent/meshagent',
            '@meshagent/meshagent-react',
            '@meshagent/meshagent-tailwind'
        ],
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            '@meshagent/meshagent': fileURLToPath(new URL('../../meshagent-ts/src', import.meta.url)),
            '@meshagent/meshagent-react': fileURLToPath(new URL('../../meshagent-react/src', import.meta.url)),
            '@meshagent/meshagent-tailwind': fileURLToPath(new URL('../../meshagent-tailwind/src', import.meta.url)),
        },
    },
});
