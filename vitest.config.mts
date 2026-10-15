import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      // The real package throws unless it's built by Next.js; tests run under plain Node.
      "server-only": fromRoot("./src/test/server-only-stub.ts"),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
