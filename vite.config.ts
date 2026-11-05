import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const developmentServiceWorkerPath = fileURLToPath(new URL('./dev/sw-dev.js', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'serve-development-service-worker',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/sw-dev.js', (request, response, next) => {
          if (request.method !== 'GET') {
            next()
            return
          }

          void readFile(developmentServiceWorkerPath, 'utf8')
            .then((source) => {
              response.statusCode = 200
              response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
              response.setHeader('Cache-Control', 'no-store')
              response.end(source)
            })
            .catch(next)
        })
      },
    },
    tailwind(),
    react(),
  ],
  build: {
    manifest: true,
  },
})
