import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || false,
    // Tauri's Rust target directory contains locked executable build artifacts.
    // Vite must not watch it on Windows.
    watch: { ignored: ["**/src-tauri/**", "**/node_modules/**"] },
  },
  build: { outDir: "dist", target: "es2020" },
});
