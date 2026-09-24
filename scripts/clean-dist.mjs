// 清空 dist 再构建：
// 本机 Node 25 的 fs.rm/fs.rmSync 遇到含非 ASCII 字符的路径（如【4】）会原生崩溃（0xC0000409），
// Rollup 的 emptyDir 同样依赖 fs.rm，因此先在构建前用 PowerShell Remove-Item 清空。
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (existsSync(dist)) {
  try {
    execSync(`powershell.exe -NoProfile -Command "Remove-Item -Recurse -Force -LiteralPath '${dist}'"`, { stdio: "ignore" });
    console.log("[clean-dist] 已清空 dist");
  } catch {
    console.log("[clean-dist] 清理 dist 失败（忽略，继续构建）");
  }
}
