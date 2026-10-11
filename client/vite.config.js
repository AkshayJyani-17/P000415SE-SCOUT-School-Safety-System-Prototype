import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    // Repairs the localStorage global before any test runs. See the file.
    setupFiles: ['./src/tests/setup.js'],
  },
})
