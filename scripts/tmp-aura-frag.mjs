// 统计：以灵气图标开头的 bg-power 块中，疑似「效果续行块」（无✦频率、文本较长）的数量
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
let cnt = 0;
const frags = [];
for (const e of d) {
  const src = e.sourceText || "";
  const re = /<div class="bold bg-power">\{\{\$:\/dnd\/images\/aura\}\}([^✦<]{6,})<\/div>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const t = m[1].replace(/\s+/g, "").slice(0, 24);
    // 正常灵气块形如「名称（类型）✦灵气N」；无✦且文本长 → 续行块
    if (!/（[^）]*）✦/.test(m[1])) {
      cnt++;
      if (frags.length < 12) frags.push(`${e.name} → ${t}`);
    }
  }
}
console.log("疑似续行块数量:", cnt);
frags.forEach((f) => console.log(" ", f));
