import { readFileSync } from "node:fs";
import { parseCreature, parseSegments } from "../src/monsterParse.ts";
const d = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
const arr = Array.isArray(d) ? d : d.creatures;
const targets = [
  ["独眼巨人散兵", "跳砍冲锋（武器）"],
  ["高斯眼魔", "眼魔射线"],
  ["成年精金龙", "龙息（雷鸣）"],
  ["风巨灵天空领主", "元素制控"],
  ["老年白龙", "行动恢复"],
  ["普通眼魔", "眼魔射线"],
];
for (const [mn, pn] of targets) {
  const e = arr.find((x) => x.name && x.name.includes(mn));
  if (!e) { console.log("NOT FOUND", mn); continue; }
  const s = parseCreature(e);
  const a = s.attacks.find((x) => x.name.includes(pn));
  console.log("==== " + mn + " · " + pn);
  if (!a) { console.log("   攻击未找到"); continue; }
  const raw = e.sourceText;
  const bi = raw.indexOf(a.name);
  console.log("   range=" + a.range, "atk=" + a.attack, "attackVar=" + a.attackVar, "defense?" , "hit=" + (a.hit ?? "").slice(0, 40));
  console.log("   unparsed=" + JSON.stringify(a.unparsed));
  // 打印该威能原始描述块
  const i = raw.indexOf(a.name);
  if (i !== -1) {
    const chunk = raw.slice(i, i + 700).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log("   DESC: " + chunk.slice(0, 400));
  }
}
