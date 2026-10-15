import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["pwa-icon.svg", "pwa-icon-192.png", "pwa-icon-512.png"],
      manifest: {
        id: "/",
        name: "WebADB Desk",
        short_name: "WebADB",
        lang: "zh-CN",
        description: "通过浏览器管理、启动并控制 Android 设备与应用。",
        theme_color: "#282c34",
        background_color: "#282c34",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        orientation: "any",
        start_url: "/",
        scope: "/",
        categories: ["utilities", "productivity"],
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,bin,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
      },
    }),
  ],
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
      },
    },
  },
});
