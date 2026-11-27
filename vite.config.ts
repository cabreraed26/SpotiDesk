import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;
const isPublicBuild = process.env.SPOTIDESK_PUBLIC_BUILD === "1";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  ...(isPublicBuild
    ? {
        define: {
          "import.meta.env.VITE_SPOTIFY_CLIENT_ID": JSON.stringify(""),
        },
      }
    : {}),

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
