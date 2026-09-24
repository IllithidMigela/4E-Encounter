export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  total: number;
  categories: Record<string, { count: number; file: string }>;
}

export interface SearchEntry {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  tags: string[];
  origin?: "official" | "user";
  source?: string;
  text: string;
}

export interface LinkRef {
  target: string;
  alias?: string;
}

export interface WikiInfo {
  transclusions: string[];
  links: LinkRef[];
  macros: string[];
  headings: string[];
}

export interface Entry {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  tags: string[];
  // 数据层标识：official=官方规范化数据；user=个人资源池（自制）。缺省视为官方。
  origin?: "official" | "user";
  source?: string;
  magazine?: string;
  sourceText: string;
  // 私设条目正文格式：md=Markdown（默认，新建/编辑后写入）；wiki=旧版 wikitext
  bodyFormat?: "md" | "wiki";
  fields: Record<string, string>;
  wiki: WikiInfo;
  // 分类特定字段（英文规范键）
  usage?: string;
  usageZh?: string;
  powerKind?: string;
  grantedBy?: string;
  powerType?: string;
  actionType?: string;
  keywords?: string;
  range?: string;
  level?: string;
  flavorText?: string;
  details?: string;
  skill?: string;
  tier?: string;
  tierZh?: string;
  prerequisite?: string;
  benefit?: string;
  itemLevel?: string;
  itemCategory?: string;
  itemSuitable?: string;
  rarity?: string;
  rarityEn?: string;
  ritualLevel?: string;
  keySkill?: string;
  ritualCategory?: string;
  size?: string;
  speed?: string;
  vision?: string;
  abilityOne?: string;
  abilityTwo?: string;
  role?: string;
  roleEn?: string;
  powerSource?: string;
  powerSourceEn?: string;
  hybrid?: string;
  terms?: Record<string, string>;
  [key: string]: unknown;
}
