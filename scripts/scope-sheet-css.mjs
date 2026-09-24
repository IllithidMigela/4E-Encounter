// 把 4E-NEXT 的人物卡样式表作用域限定在 `.es-4e` 容器内，避免污染遭遇模拟器全局样式。
// 保留 `:root` 变量定义（人物卡所需的 MD 令牌）；丢弃 html/body/#root 全局布局规则。
//
// 作用域例外（保持全局，不加 .es-4e 前缀）：
// - @keyframes：动画名不做改名（宿主仅用 es-* 前缀动画名，无冲突）；
//   旧版改名方案曾把 `animation: md3-ink` 引用漏改导致动画失效。
// - portal 类：车卡器选择器/裁剪弹窗用 createPortal 渲染到 document.body，
//   脱离 .es-4e 容器；含这些类的选择器必须保持全局才能命中。
//   portal 类集合 = 弹窗组件文件里所有字符串字面量（过近似：多识别的类在 CSS 中
//   无规则，去作用域是无操作，无害）。排除 material-symbols-outlined（图标字体类，
//   宿主也使用，两边均只作为后代选择器出现，无需全局化）。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "..", "4E-NEXT", "web", "src");
// 多个源样式表 → 各自生成作用域化产物（sheet.css / sheet-extra.css / sheet-glance.css）
// global: true 的文件整表保持全局（不加 .es-4e 前缀）。
// styles.glance.css（速览页）全局化的原因：速览弹窗（SheetDialog/短休/长休/掷骰结果）与
// gl-toast 由 OverviewView createPortal 渲染到 document.body，脱离 .es-4e 容器；
// gl-* 类名宿主完全未使用，全局无污染风险。
const CSS_FILES = [
  ["styles.css", "sheet.css"],
  ["styles.extra.css", "sheet-extra.css"],
  ["styles.glance.css", "sheet-glance.css", true],
];

// ---------- portal 类集合（过近似枚举） ----------
// 专用的弹窗组件：收集文件内全部字符串字面量（多识别的类在 CSS 中无规则，是无操作，无害）
// 文件按 sheet/ → components/ → overview/ 顺序解析（SheetDialog 在 components/，速览组件在 overview/）
const PORTAL_COMPONENTS = [
  "PickerModal.tsx", "ClassPickerModal.tsx", "FeatSlotPicker.tsx",
  "ItemSlotPicker.tsx", "PowerSlotPicker.tsx", "PortraitFrame.tsx",
  "EntryCard.tsx", "EntryDetail.tsx", "CatalogPicker.tsx",
  // sheet-overhaul-v2 新增弹窗（createPortal → document.body）
  "FeatChoiceDialog.tsx", "PowerReplacementDialog.tsx", "RitualPicker.tsx", "SmartHover.tsx",
  // SheetDialog（MD3 对话框壳）：OverviewView（速览）把其弹窗 createPortal 到 document.body，
  // .sheet-dialog* 系列选择器必须保持全局才能命中 body 下的弹窗
  "SheetDialog.tsx",
];
// CharacterSheet.tsx 内含 swap / base-item 两个 portal 片段，但其主体是内嵌卡（.sheet/.content 等），
// 整文件收集会把主卡类名也全局化 → 只收 portal 片段用到的类前缀
const CHARACTERSHEET_PORTAL_PREFIX = /^(picker-|swap-|base-|bi-|cl-|cr-|class-|equip-|hint$|incremental-|sf-|slot-filter|crop-)/;
const EXCLUDE = new Set(["material-symbols-outlined"]);
const portalClasses = new Set();
for (const f of PORTAL_COMPONENTS) {
  let t = null;
  for (const sub of ["sheet", "components", "overview"]) {
    try {
      t = readFileSync(join(root, "src", "4ebuild", sub, f), "utf8");
      break;
    } catch {
      /* 尝试下一个目录 */
    }
  }
  if (t === null) continue;
  // 所有双引号/反引号字符串字面量中，形如类名（小写开头、-_/单词字符、空格分隔）的 token
  for (const m of t.matchAll(/["'`]([^"'`\n]+)["'`]/g)) {
    for (const tok of m[1].split(/\s+/)) {
      if (/^[a-z][a-z0-9_-]*$/.test(tok) && !EXCLUDE.has(tok)) portalClasses.add(tok);
    }
  }
}
{
  const t = readFileSync(join(root, "src", "4ebuild", "sheet", "CharacterSheet.tsx"), "utf8");
  for (const m of t.matchAll(/["'`]([^"'`\n]+)["'`]/g)) {
    for (const tok of m[1].split(/\s+/)) {
      if (CHARACTERSHEET_PORTAL_PREFIX.test(tok) && !EXCLUDE.has(tok)) portalClasses.add(tok);
    }
  }
}

// SmartHover（portal=true 时弹层渲染到 document.body）：popClass 由调用方传入，
// 收集 sheet/ 目录全部 popClass="..." 字面量（如 wiki-ref-pop / cls-option-pop）
{
  const dir = join(root, "src", "4ebuild", "sheet");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".tsx")) continue;
    const t = readFileSync(join(dir, f), "utf8");
    for (const m of t.matchAll(/popClass=\{?"([a-z][a-z0-9 -]*)"/g)) {
      for (const tok of m[1].split(/\s+/)) {
        if (/^[a-z][a-z0-9_-]*$/.test(tok) && !EXCLUDE.has(tok)) portalClasses.add(tok);
      }
    }
  }
}

// 与宿主 styles.css 类名冲突检测：portal 类保持全局，若与宿主类撞名会互相污染 → 自动排除并警告。
// 例外：宿主 styles.css 中刻意为 portal 写的互补规则（弹层内 button 交互层/.md3-ink 水波纹），
// 这些类名在宿主出现是有意共享，不能因此把 sheet.css 的弹层定位规则作用域化（否则弹窗背景失效）
const INTENTIONAL_SHARED = new Set(["picker-overlay", "crop-overlay", "md3-ink"]);
{
  const host = readFileSync(join(root, "src", "styles.css"), "utf8");
  const hostClasses = new Set([...host.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const clash = [...portalClasses].filter((c) => hostClasses.has(c) && !INTENTIONAL_SHARED.has(c));
  for (const c of clash) {
    portalClasses.delete(c);
    console.warn("[scope-sheet-css] 警告: portal 类与宿主样式撞名，保持作用域化: " + c);
  }
}

/** 选择器首个复合段（截到第一个组合器：空格/>/+/~） */
function firstCompound(selPart) {
  const m = selPart.match(/^[^\s>+~]+/);
  return m ? m[0] : selPart;
}

/** 首个复合段中是否含 portal 类：
 *  - `.picker-row.selected`、`.picker-dialog .picker-head` → 首段是 portal 类 → 全局（portal 内容需要）
 *  - `.lt-cell .topbar .portrait-frame` → 首段 .lt-cell 是卡内布局类 → 作用域化（本来就渲染在 .es-4e 内） */
function hasPortalClass(selPart) {
  const fc = firstCompound(selPart);
  for (const m of fc.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
    if (portalClasses.has(m[1])) return true;
  }
  return false;
}

// ---------- CSS 顶层拆分 ----------
/** 按顶层花括号拆分：返回 [{sel, body, raw}]；sel 已剥离注释 */
function splitTopLevel(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lb = text.indexOf("{", i);
    if (lb < 0) break;
    const sel = text.slice(i, lb).trim();
    let depth = 1;
    let j = lb + 1;
    while (j < n && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(lb + 1, j - 1);
    out.push({ sel, body, raw: text.slice(i, j) });
    i = j;
  }
  return out;
}

/** 剥离 CSS 注释（选择器文本中混入注释会导致 .es-4e /* xx *\/ @keyframes 这类非法规则） */
function stripComments(sel) {
  return sel.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
}

function isGlobalSelectors(sel) {
  // 丢弃影响全局布局/背景的规则
  return /(^|,)\s*(html|body|#root)\b/.test(sel);
}

function isRoot(sel) {
  return /(^|,)\s*:root\s*$/.test(sel);
}

/** 逐段作用域化：含 portal 类的段保持全局，其余加 .es-4e 前缀；global=true 时全部保持全局 */
function prefixSelector(sel, global) {
  return sel
    .split(",")
    .map((s) => {
      const t = s.trim();
      if (!t) return "";
      if (t.startsWith("&")) return t; // 嵌套（本例未用）
      if (global) return t; // 整表全局（如速览页：弹窗渲染到 document.body）
      if (t.startsWith(".es-4e")) return t; // 已作用域
      if (hasPortalClass(t)) return t; // portal 弹窗渲染在 document.body 下，保持全局
      return ".es-4e " + t;
    })
    .filter(Boolean)
    .join(", ");
}

function scopeRules(inner, global) {
  return splitTopLevel(inner)
    .map(({ sel, body }) => {
      const s = stripComments(sel);
      if (!s) return "";
      if (isGlobalSelectors(s) || isRoot(s)) return "";
      const p = prefixSelector(s, global);
      if (!p) return "";
      return p + "{\n" + body + "\n}\n";
    })
    .join("\n");
}

function scopeFile(css, global) {
  let out = "";
  const parts = splitTopLevel(css);
  for (const part of parts) {
    const s = stripComments(part.sel);
    if (!s) continue; // 纯注释块
    if (s.startsWith("@keyframes")) {
      // 动画名保持原名（宿主 es-* 动画名无冲突；改名会漏改 animation 引用）
      out += s + "{\n" + part.body + "\n}\n";
    } else if (s.startsWith("@media")) {
      out += s + "{\n" + scopeRules(part.body, global) + "\n}\n";
    } else if (s.startsWith("@font-face") || s.startsWith("@import")) {
      out += part.raw; // 字体/引入原样保留
    } else if (isGlobalSelectors(s)) {
      // 丢弃 html/body/#root 全局布局与背景规则，避免污染宿主应用
      out += "";
    } else if (isRoot(s)) {
      out += ":root{\n" + part.body + "\n}\n";
    } else {
      const p = prefixSelector(s, global);
      if (p) out += p + "{\n" + part.body + "\n}\n";
    }
  }
  return out;
}

for (const entry of CSS_FILES) {
  const [srcName, destName, global] = entry;
  const dest = join(root, "src", "4ebuild", destName);
  const out = scopeFile(readFileSync(join(srcRoot, srcName), "utf8"), global === true);
  writeFileSync(dest, out, "utf-8");
  console.log("[scope-sheet-css] " + srcName + " -> " + destName + (global === true ? "（整表全局）" : "") + "（" + out.length + " 字节，portal 类 " + portalClasses.size + " 个）");
}