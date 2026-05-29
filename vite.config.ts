import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis"
  },
  optimizeDeps: {
    include: ["buffer", "bte-projection"],
    esbuildOptions: {
      inject: ["src/buffer-shim.ts"]
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
