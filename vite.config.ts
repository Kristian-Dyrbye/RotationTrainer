import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: served from https://kristian-dyrbye.github.io/RotationTrainer/
export default defineConfig({
  base: '/RotationTrainer/',
  plugins: [react()],
})
