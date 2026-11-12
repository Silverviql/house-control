import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // True in the single-file build for the Home Assistant card, which has no use for the Mac's
  // island or the AI console: left out, their styles cannot clash with the editor's in one sheet.
  define: { __HA_EMBED__: JSON.stringify(Boolean(process.env.HOUSE_SINGLE_FILE)) },
  // 5199 by default; PORT overrides it when that one is taken.
  server: { port: Number(process.env.PORT) || 5199, strictPort: true },
  build: {
    target: 'safari17',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    // HOUSE_SINGLE_FILE=1 (the Home Assistant card): the editor and the other lazily loaded modes
    // go into the one bundle. The card runs it in a sandboxed frame that cannot fetch further files.
    ...(process.env.HOUSE_SINGLE_FILE ? { cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } } : {}),
  },
});
