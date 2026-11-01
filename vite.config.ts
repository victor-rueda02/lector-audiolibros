import { defineConfig } from 'vite';

// La app se publica en https://victor-rueda02.github.io/lector-audiolibros/
export default defineConfig({
  base: '/lector-audiolibros/',
  worker: { format: 'es' },
  build: { target: 'safari16', sourcemap: true },
});
