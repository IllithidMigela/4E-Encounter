import { parsePowerEffects } from "../src/monsterParse.ts";
const cases = [
  "任何进入该灵气或在其内结束回合的敌人受到 10 点火焰伤害",
  "任何在该灵气内开始回合的该火巨人熔岩之主的重伤的盟友恢复 10点生命值",
  "任何在该灵气内结束回合的不死生物盟友恢复 10点生命值",
  "任何在该灵气内开始回合的重伤的恶魔、卓尔或蜘蛛盟友恢复 10点生命值",
  "目标恢复 5点生命值",
  "该巨魔恢复3点额外生命值",
];
for (const s of cases) {
  const r = parsePowerEffects(s);
  console.log(`--- "${s}"`);
  for (const sp of r.specs) {
    console.log(`    kind=${sp.kind} value=${sp.value} trigger=${sp.trigger ?? "-"} faction=${sp.faction ?? "-"} targetBloodied=${sp.targetBloodied ? "T" : "F"} bloodiedOnly=${sp.bloodiedOnly ? "T" : "F"}`);
    console.log(`      raw: "${sp.raw}"`);
  }
  console.log(`    allParsed=${r.allParsed}`);
}
