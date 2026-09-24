import {
  themeFromSourceColor,
  argbFromHex,
  hexFromArgb,
  sourceColorFromImage,
  type Theme,
} from "@material/material-color-utilities";

export type SeedMode = "preset" | "picker" | "portrait" | "background";

// Nord 风格预设色板（冰蓝/极夜/雪花与冰霜同为近似偏蓝灰色调，已移除）
export const NORD_PRESETS: { name: string; color: string }[] = [
  { name: "冰霜", color: "#5e81ac" },
  { name: "极光绿", color: "#a3be8c" },
  { name: "极光紫", color: "#b48ead" },
  { name: "极光红", color: "#bf616a" },
  { name: "极光黄", color: "#ebcb8b" },
];

// MD3 扩展表面角色：由 neutral 色调板的特定 tone 推导（官方 spec）
const SURFACE_TONES = {
  light: {
    surfaceDim: 87,
    surfaceBright: 98,
    surfaceContainerLowest: 100,
    surfaceContainerLow: 96,
    surfaceContainer: 94,
    surfaceContainerHigh: 92,
    surfaceContainerHighest: 90,
  },
  dark: {
    surfaceDim: 6,
    surfaceBright: 24,
    surfaceContainerLowest: 4,
    surfaceContainerLow: 10,
    surfaceContainer: 12,
    surfaceContainerHigh: 17,
    surfaceContainerHighest: 22,
  },
} as const;

function toToken(role: string): string {
  return "--md-sys-color-" + role.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

export function themeToCssVars(theme: Theme, isDark: boolean): Record<string, string> {
  const scheme = isDark ? theme.schemes.dark : theme.schemes.light;
  // 0.3.0 的 Scheme 把颜色存在 props 对象里
  const props = (scheme as unknown as { props?: Record<string, number> }).props ?? {};
  const vars: Record<string, string> = {};
  for (const [role, argb] of Object.entries(props)) {
    vars[toToken(role)] = hexFromArgb(argb);
  }
  // 扩展表面角色
  const tones = isDark ? SURFACE_TONES.dark : SURFACE_TONES.light;
  for (const [role, tone] of Object.entries(tones)) {
    vars[toToken(role)] = hexFromArgb(theme.palettes.neutral.tone(tone));
  }
  vars["--md-sys-color-surface-tint"] = hexFromArgb(theme.palettes.primary.tone(40));
  return vars;
}

export function applyCssVars(vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

export function seedHexToTheme(hex: string): Theme {
  return themeFromSourceColor(argbFromHex(hex));
}

// 从角色立绘图片提取种子色
export async function imageToSeedHex(img: HTMLImageElement): Promise<string> {
  const argb = await sourceColorFromImage(img);
  return hexFromArgb(argb);
}
