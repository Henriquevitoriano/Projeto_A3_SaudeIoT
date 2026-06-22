import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8090,
    strictPort: true, // se 8090 estiver ocupada, falha em vez de pegar outra
    open: false,      // não abre navegador automaticamente
  },
  build: {
    outDir: "dist",
    sourcemap: false, // produção: não vaza código original
  },
});
