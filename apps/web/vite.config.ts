import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative paths so the build also works from a sub-folder (GitHub or Cloudflare Pages).
  base: "./",
});
