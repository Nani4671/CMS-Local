import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget =
    env.REACT_APP_API_PROXY_TARGET || "https://localhost:7178";

  return {
    plugins: [react()],
    define: {
      "process.env": {
        NODE_ENV: mode === "production" ? "production" : "development",
        PUBLIC_URL: "",
        REACT_APP_API_BASE_URL: env.REACT_APP_API_BASE_URL,
        REACT_APP_API_ASSET_BASE_URL: env.REACT_APP_API_ASSET_BASE_URL,
        REACT_APP_API_PROXY_TARGET: env.REACT_APP_API_PROXY_TARGET,
      },
    },
    server: {
      port: 3000,
      strictPort: false,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          headers: {
            "ngrok-skip-browser-warning": "true",
          },
        },
        "/images": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          headers: {
            "ngrok-skip-browser-warning": "true",
          },
        },
        "/uploads": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          headers: {
            "ngrok-skip-browser-warning": "true",
          },
        },
      },
    },
    optimizeDeps: {
      entries: ["index.html"],
    },
    build: {
      outDir: "build",
    },
  };
});
