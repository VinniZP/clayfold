import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const mock = process.env.VITE_MOCK === "1";
const outDir = fileURLToPath(new URL("./dist", import.meta.url));

const server = "http://127.0.0.1:4317";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // StyleX must run before the React plugin so Fast Refresh keeps working.
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  define: { __MOCK__: JSON.stringify(mock) },
  server: {
    port: 5173,
    // StyleX resolves breakpoint constants only once tokens.stylex.ts is compiled; without a warm-up the first
    // CSS request of a cold dev server can come earlier and fail with "Invalid empty selector".
    warmup: { clientFiles: ["./src/theme/tokens.stylex.ts", "./src/main.tsx"] },
    proxy: mock ? undefined : { "/api": { target: server }, "/mcp": { target: server } },
  },
  build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
