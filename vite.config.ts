import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 内嵌车卡器版本：取自同步源 4E-NEXT/web/package.json（src/4ebuild 的快照版本）
function carbuildVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "4E-NEXT", "web", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0";
  } catch {
    return "0";
  }
}

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __CARBUILD_VERSION__: JSON.stringify(carbuildVersion()) },
});
