import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // sem isso, um erro no APK (produção, sem devtools conectado) vem só com posições minificadas tipo
  // "index-X.js:22:20165", impossível de saber qual linha do código de verdade quebrou. Com sourcemap, o
  // navegador consegue mapear de volta — próximo crash reportado vai dar pra achar a causa real, não chutar.
  build: { sourcemap: true },
})
