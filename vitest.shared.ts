import path from "node:path";
import ts from "typescript";
import type { Plugin } from "vite";

// Tests import workspace packages from their TypeScript source, so no build is needed before `npm test`.
export const workspaceAlias = {
  "@force-pulse/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
  "@force-pulse/db": path.resolve(__dirname, "packages/db/src/index.ts"),
};

/**
 * Compiles test-time TypeScript with the TypeScript compiler instead of esbuild, because NestJS needs
 * decorator metadata (constructor parameter types) and esbuild doesn't emit it.
 * Use with `esbuild: false` in the Vitest config.
 */
export function typescriptWithDecorators(): Plugin {
  return {
    name: "typescript-with-decorators",
    enforce: "pre",
    transform(code, id) {
      if (!/\.ts$/.test(id) || id.includes("node_modules")) return null;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          useDefineForClassFields: false,
          sourceMap: true,
        },
      });
      return { code: out.outputText, map: out.sourceMapText ?? null };
    },
  };
}
