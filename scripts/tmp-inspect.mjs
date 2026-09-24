import fs from "node:fs";
const d = JSON.parse(fs.readFileSync("public/data/powers.json", "utf8"));
const ms = d.monsters;
for (const k of ["巴菲门特 Baphomet", "格拉兹特 Graz'zt"]) {
  const h = ms[k];
  console.log("================", k);
  console.log("stats:", JSON.stringify({
    hp: h.hp, ac: h.ac, fort: h.fortitude ?? h.fort, ref: h.reflex ?? h.ref,
    will: h.will, size: h.size, speed: h.speed, role: h.role,
  }));
  for (const p of h.attacks) {
    console.log("---", p.name, "|", p.kind, "|", p.freq ?? "");
    console.log("   ", JSON.stringify(p));
  }
}
