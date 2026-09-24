import type { Manifest, SearchEntry, Entry } from "./types";
import { loadUserEntries } from "../lib/userdata";
import { toSearchEntry } from "../lib/bundle";

const BASE = import.meta.env.BASE_URL + "data/";
const cache = new Map<string, unknown>();

async function fetchJson<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit) return hit as T;
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error("加载失败: " + path + " (" + res.status + ")");
  const data = await res.json();
  cache.set(path, data);
  return data as T;
}

/** 官方层：直接读取派生 JSON，统一补 origin="official"。 */
async function loadOfficial(cat: string): Promise<Entry[]> {
  const data = await fetchJson<Entry[]>("categories/" + cat + ".json");
  return data.map((e) => ({ ...e, origin: "official" as const }));
}

/** 用户层：从个人资源池读取该分类的自制条目（实时读取，编辑/导入后即时生效）。 */
function loadUser(cat: string): Entry[] {
  return loadUserEntries().filter((e) => e.category === cat && e.origin === "user");
}

// 合并：先官方后用户，同 id 时用户覆盖官方（用户自定义优先，无冲突时行为与官方一致）。
function merge(cat: string): Promise<Entry[]> {
  return loadOfficial(cat).then((official) => {
    const byId = new Map<string, Entry>();
    for (const e of official) byId.set(e.id, e);
    for (const e of loadUser(cat)) byId.set(e.id, e);
    return [...byId.values()];
  });
}

export function loadManifest(): Promise<Manifest> {
  return fetchJson<Manifest>("manifest.json");
}

/** 搜索索引：官方 + 用户合并，让自制条目也能被搜索到。 */
export async function loadSearchIndex(): Promise<SearchEntry[]> {
  const official = await fetchJson<SearchEntry[]>("search-index.json");
  const user = loadUserEntries().map(toSearchEntry);
  if (user.length === 0) return official;
  const byId = new Map<string, SearchEntry>();
  for (const s of official) byId.set(s.id, s);
  for (const s of user) byId.set(s.id, s);
  return [...byId.values()];
}

export function loadRelations(): Promise<{ powerByGrantedBy: Record<string, string[]> }> {
  return fetchJson("relations.json");
}

export function loadCategory(cat: string): Promise<Entry[]> {
  return merge(cat);
}

/** 按分类返回仅官方条目（如需访问原始官方数据，可绕过用户层覆盖）。 */
export function loadOfficialCategory(cat: string): Promise<Entry[]> {
  return loadOfficial(cat);
}