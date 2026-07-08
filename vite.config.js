import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      headers: { 'Access-Control-Allow-Origin': '*' }
    },
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(
        env.VITE_API_BASE || 'http://localhost:8000'
      )
    },
    build: { outDir: 'dist', sourcemap: true }
  }
})
