import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Vercel serves this project at domain root (food-mela-admin.vercel.app),
  // so assets must resolve under /, not /admin/. (The /admin/ sub-path build
  // belongs to the merged single-domain setup, not this deployment.)
  base: '/',
  server: { port: 5174, host: true },
  preview: { port: 4174 },
});
