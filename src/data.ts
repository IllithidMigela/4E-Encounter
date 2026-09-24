// 数据加载 + 怪物解析（解析逻辑见 ./monsterParse.ts，此处 re-export 保持调用方兼容）
import type { Entry, CreatureClassMap } from "./monsterParse";
export * from "./monsterParse";

/** 从 public/data 加载 JSON（构建后为静态文件） */
async function loadJson<T>(file: string): Promise<T[]> {
  const res = await fetch(import.meta.env.BASE_URL + "data/" + file);
  if (!res.ok) throw new Error("加载失败: " + file);
  return (await res.json()) as T[];
}

/** 加载「name -> 对象」型 JSON（总表白名单） */
async function loadJsonObject<T>(file: string): Promise<Record<string, T>> {
  const res = await fetch(import.meta.env.BASE_URL + "data/" + file);
  if (!res.ok) throw new Error("加载失败: " + file);
  return (await res.json()) as Record<string, T>;
}

export interface LibraryData {
  creatures: Entry[];
  classes: Entry[];
  races: Entry[];
  /** 总表怪物分类白名单：按名称覆盖 role/origin/category/species */
  creatureClass: CreatureClassMap;
  ready: boolean;
  error?: string;
}

export async function loadLibrary(): Promise<LibraryData> {
  try {
    const [creatures, classes, races, creatureClass] = await Promise.all([
      loadJson<Entry>("creature.json"),
      loadJson<Entry>("class.json"),
      loadJson<Entry>("race.json"),
      loadJsonObject<CreatureClassMap[string]>("creature-class.json"),
    ]);
    return { creatures, classes, races, creatureClass, ready: true };
  } catch (e) {
    return { creatures: [], classes: [], races: [], creatureClass: {}, ready: false, error: String(e) };
  }
}
