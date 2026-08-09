import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": `${import.meta.dirname}/src` } },
  test: {
    coverage: { reporter: ["text", "json", "html"] },
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
