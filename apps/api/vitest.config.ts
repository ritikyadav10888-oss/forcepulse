import { defineConfig } from "vitest/config";
import { typescriptWithDecorators, workspaceAlias } from "../../vitest.shared";

export default defineConfig({
  plugins: [typescriptWithDecorators()],
  esbuild: false,
  resolve: { alias: workspaceAlias },
  // Each test file starts its own in-memory PostgreSQL; too many at once runs the machine out of memory.
  test: { testTimeout: 30_000, hookTimeout: 120_000, maxWorkers: 3 },
});
