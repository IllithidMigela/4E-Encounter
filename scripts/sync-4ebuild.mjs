// 把最新版车卡器（4E-NEXT/web/src）的源码同步到本项目的内嵌目录 src/4ebuild/
// 同步范围：sheet/ lib/ data/ components/ overview/ 五个目录 + theme.ts / ThemeProvider.tsx / OverviewView.tsx
// （overview/ + OverviewView.tsx 为速览页，供角色卡视图内嵌速览面板使用）
// 文件原样复制（不做任何修改），保证车卡器更新后可一条命令重新同步。
// 末尾调用 scope-sheet-css.mjs 重新生成作用域化样式 sheet.css。
//
// 注意：本机 Node 25 的 fs.rm/rmSync/cpSync 遇到含非 ASCII 字符的路径（如【4】）
// 会原生崩溃（0xC0000409），因此删除用 PowerShell Remove-Item，复制用 readFileSync+writeFileSync。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcRoot = join(root, "..", "4E-NEXT", "web", "src");
const destRoot = join(root, "src", "4ebuild");

if (!existsSync(srcRoot)) {
  console.error("[sync-4ebuild] 未找到车卡器源码: " + srcRoot);
  process.exit(1);
}

// 复制清单：目录整体同步（先清空再复制），单文件直接覆盖
const DIRS = ["sheet", "lib", "data", "components", "overview"];
const FILES = ["theme.ts", "ThemeProvider.tsx", "OverviewView.tsx"];

let nFiles = 0;

/** 用 PowerShell 清空目录内容（保留目录本身），规避 Node 非 ASCII 路径崩溃 */
function clearDir(dir) {
  if (!existsSync(dir)) return;
  try {
    execSync(`powershell.exe -NoProfile -Command "Get-ChildItem -LiteralPath '${dir}' | Remove-Item -Recurse -Force"`, { stdio: "ignore" });
  } catch {
    console.warn("[sync-4ebuild] 清空目录失败（继续覆盖复制）: " + dir);
  }
}

/** 递归复制目录（写入用 readFileSync+writeFileSync） */
function copyDir(srcDir, destDir) {
  if (!existsSync(srcDir)) {
    console.warn("[sync-4ebuild] 源目录缺失，跳过: " + srcDir);
    return;
  }
  clearDir(destDir);
  if (!existsSync(destDir)) {
    mkdirSyncRecursive(destDir);
  }
  for (const name of readdirSync(srcDir)) {
    const s = join(srcDir, name);
    const d = join(destDir, name);
    if (statSync(s).isDirectory()) {
      copyDir(s, d);
    } else {
      writeFileSync(d, readFileSync(s));
      nFiles++;
    }
  }
}

/** 逐级创建目录（mkdirSync 单级安全，recursive 版本也走同一实现） */
function mkdirSyncRecursive(dir) {
  const parts = dir.split(/[\\/]/);
  let cur = parts[0];
  for (let i = 1; i < parts.length; i++) {
    cur = join(cur, parts[i]);
    if (!existsSync(cur)) {
      try {
        mkdirSync(cur);
      } catch {
        // 已存在等场景忽略
      }
    }
  }
}

for (const d of DIRS) {
  copyDir(join(srcRoot, d), join(destRoot, d));
  console.log(`[sync-4ebuild] 目录 ${d}/ 已同步`);
}

for (const f of FILES) {
  const s = join(srcRoot, f);
  if (!existsSync(s)) {
    console.warn("[sync-4ebuild] 源文件缺失，跳过: " + f);
    continue;
  }
  writeFileSync(join(destRoot, f), readFileSync(s));
  nFiles++;
  console.log(`[sync-4ebuild] 文件 ${f} 已同步`);
}

console.log(`[sync-4ebuild] 共复制 ${nFiles} 个文件`);

// 重新生成作用域化样式 sheet.css（挂 .es-4e 容器下，避免污染遭遇模拟器全局样式）
const scopeScript = join(__dirname, "scope-sheet-css.mjs");
const res = spawnSync(process.execPath, [scopeScript], { stdio: "inherit" });
if (res.status !== 0) {
  console.error("[sync-4ebuild] scope-sheet-css.mjs 执行失败");
  process.exit(1);
}
console.log("[sync-4ebuild] 完成");
