import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "client", "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests share the uploads/ directory and each test file's
    // server startup sweep clears uploads/tmp; running files in parallel
    // causes races (ENOENT during multer writes). Run files serially.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
