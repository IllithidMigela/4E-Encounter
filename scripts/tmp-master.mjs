// 查看恐怖守护者与同类"主人依赖"守护者的 attack 解析现状
import { readFileSync } from "node:fs";
import { parseCreature } from "../src/monsterParse.ts";
const creatures = JSON.parse(readFileSync("public/data/creature.json", "utf8"));
for (const entry of creatures) {
  if (!/恐怖守护者/.test(entry.name ?? "")) continue;
  const s = parseCreature(entry);
  console.log("=== " + entry.name + " ===");
  for (const a of s.attacks ?? []) {
    const eff = a.effectSpecs ?? [];
    console.log(`kind=${a.kind}  name=${a.name}  range=${a.range ?? ""}  freq=${a.freq ?? ""}`);
    console.log(`   text=${JSON.stringify((a.effectText ?? "").slice(0, 120))}`);
    console.log(`   specs=${eff.length ? eff.map((e) => e.kind + ":" + (e.label ?? "")).join(" | ") : "(空)"}`);
  }
}