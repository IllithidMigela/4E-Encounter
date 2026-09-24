// 临时检查 4：召唤兽 rawText 原文 + 攻击块 HTML 结构
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../public/data/powers.json", import.meta.url), "utf8"));
const m = Object.values(d.monsters).find((x) => x.name === "碧玉锤尾巨兽");
console.log(m.rawText.slice(0, 2600));
