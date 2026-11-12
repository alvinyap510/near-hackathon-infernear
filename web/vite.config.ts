import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The repo keeps one .env at its root; only VITE_* variables reach the browser.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  // The NEAR wallet libraries read Node's `global`; without this the wallet dialog fails in the built app.
  define: { global: 'globalThis' },
});
