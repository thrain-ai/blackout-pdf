import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps asset paths relative so the same build works on
// <user>.github.io/blackout-pdf/ and on a custom apex domain.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
  },
  preview: {
    // Allow previewing across the LAN/tailnet without committing hostnames:
    // PREVIEW_ALLOW=my.host npx vite preview --host 0.0.0.0
    allowedHosts: process.env.PREVIEW_ALLOW ? [process.env.PREVIEW_ALLOW] : [],
  },
  server: {
    allowedHosts: process.env.PREVIEW_ALLOW ? [process.env.PREVIEW_ALLOW] : [],
  },
});
