import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_LABRAT_API_PROXY_TARGET || "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  base: "/LabRat/",
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
