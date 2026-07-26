import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const devApiProxy = process.env.VITE_DEV_API_PROXY

export default defineConfig({
  // Relative assets work on GitHub Pages project sites as well as standard hosts.
  base: './',
  plugins: [react(), tailwindcss()],
  server: devApiProxy ? {
    proxy: {
      '/api': {
        target: devApiProxy,
        changeOrigin: true,
      },
    },
  } : undefined,
})
