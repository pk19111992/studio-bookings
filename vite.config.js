import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Build the React app under /app so it doesn't conflict with the homepage at /
  base: '/app/',
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
  }
})
