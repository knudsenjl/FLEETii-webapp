import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Fixed, non-default port + strictPort so this never silently shares/shifts
  // off of a port a sibling project's Vite server (default 5173) already holds
  // — `netlify dev` proxies to whatever port it finds first, so an ambiguous
  // port previously caused it to serve the wrong project.
  server: {
    port: 5183,
    strictPort: true,
  },
})
