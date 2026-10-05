import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Google sign-in redirects to :5173, so never silently move to another port.
    strictPort: true,
    // In dev, the API and draft sockets are proxied so the browser sees one origin.
    proxy: {
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});
