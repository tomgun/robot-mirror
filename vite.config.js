import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/robot-mirror/" : "/",
  build: {
    chunkSizeWarningLimit: 1200,
  },
}));
