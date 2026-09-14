import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Served from foodmela.online/admin (merged single-domain build) —
  // assets must resolve under /admin/, not /.
  base: '/admin/',
  server: { port: 5174, host: true },
  preview: { port: 4174 },
});
