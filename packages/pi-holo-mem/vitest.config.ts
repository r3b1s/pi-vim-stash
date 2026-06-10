import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "#src": new URL("./src", import.meta.url).pathname,
      "#test": new URL("./test", import.meta.url).pathname,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
