import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), configureServerProxy()],
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
    port: 5173,
    proxy: {
      "/tiles": {
        target: "https://tile.openstreetmap.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tiles/, "")
      }
    }
  }
});

// Add a generic tile proxy middleware for development that can fetch arbitrary
// tile URLs. This enables server-side probing of remote tile servers without
// running into browser CORS restrictions.
export function configureServerProxy() {
  return {
    name: 'tile-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url) return next();
          if (!req.url.startsWith('/tile-proxy')) return next();

          // Robustly parse query params even if req.url is provided in different forms
          const raw = req.url || '';
          const q = raw.includes('?') ? raw.split('?').slice(1).join('?') : '';
          const params = q ? new URLSearchParams(q) : new URLSearchParams();
          let target = params.get('url');

          // Also accept /tile-proxy/<base64-encoded-url> style as fallback
          if (!target && raw.startsWith('/tile-proxy/')) {
            const maybe = raw.replace('/tile-proxy/', '').split('?')[0];
            try {
              target = decodeURIComponent(maybe);
            } catch {}
          }

          // Debug log to help trace issues
          server.config.logger.info(`[tile-proxy] request ${raw} -> target=${target}`);

          if (!target) {
            res.statusCode = 400;
            res.end('missing url');
            return;
          }

          // Fetch the remote tile on the dev server (node) and stream back.
          const response = await fetch(target);
          res.statusCode = response.status;
          // Copy response headers (filtering out hop-by-hop headers)
          const hopByHop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade']);
          response.headers.forEach((value, key) => {
            try {
              if (!hopByHop.has(key.toLowerCase())) res.setHeader(key, value);
            } catch {}
          });
          res.setHeader('Access-Control-Allow-Origin', '*');
          const buffer = await response.arrayBuffer();
          res.end(Buffer.from(buffer));
        } catch (err) {
          server.config.logger.error(`[tile-proxy] error: ${String(err)}`);
          res.statusCode = 502;
          res.end(String(err));
        }
      });
    }
  };
}
