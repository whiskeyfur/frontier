import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` makes dist/index.html: one file with everything in it (the game's code, its worker, the SQLite
// engine and the stylesheets), which runs straight from the disk (file://) with no server.
export default defineConfig({
    base: './',
    plugins: [viteSingleFile({ removeViteModuleLoader: true })],
    worker: {
        // A classic worker: Chromium won't start a module worker from a blob: URL on a file:// page.
        format: 'iife',
    },
    build: {
        target: 'es2022',
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        chunkSizeWarningLimit: 100_000,
        cssCodeSplit: false,
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup.ts'],
        testTimeout: 20_000,
        pool: 'threads',
    },
});
