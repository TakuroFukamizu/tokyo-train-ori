import { defineConfig } from "vite";

export default defineConfig({
  base: "/tokyo-train-ori/",
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        landing: "landing.html",
      },
    },
  },
});
