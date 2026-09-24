// 临时检查 7：不死士兵 rawText 攻击块原始 HTML
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../public/data/powers.json", import.meta.url), "utf8"));
const m = Object.values(d.monsters).find((x) => x.name === "不死士兵");
const idx = m.rawText.indexOf("标准动作");
console.log(m.rawText.slice(idx - 80, idx + 900));
