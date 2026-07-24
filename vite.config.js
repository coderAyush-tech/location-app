import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative assets work on GitHub Pages project sites as well as standard hosts.
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY || 'https://locationfinder-pdzb.onrender.com',
        changeOrigin: true,
      },
    },
  },
})
