import { defineConfig } from "vitest/config";
import { typescriptWithDecorators, workspaceAlias } from "../../vitest.shared";

export default defineConfig({
  plugins: [typescriptWithDecorators()],
  esbuild: false,
  resolve: { alias: workspaceAlias },
  test: { testTimeout: 30_000, hookTimeout: 120_000 },
});
