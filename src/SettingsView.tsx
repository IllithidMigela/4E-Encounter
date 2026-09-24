// 设置视图：UI 偏好调整（主题色 / 棋子圆角 / 网格显示）+ 自动化开关（默认全开，关闭退回手动）
import { ACCENT_PRESETS, type AutoSettings, type Settings } from "./uiPrefs";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

/** 五组自动化开关定义：分组 | 键 | 文案 | 说明 */
const AUTO_GROUPS: {
  group: keyof AutoSettings;
  label: string;
  hint: string;
  items: { key: string; label: string; hint?: string }[];
}[] = [
  {
    group: "attack",
    label: "A 攻击判定",
    hint: "关闭后结算条展开手动填骰/判定",
    items: [
      { key: "roll", label: "自动掷攻击骰" },
      { key: "mods", label: "自动计算调整值", hint: "战优/夹击/目盲/倒地/束缚/被标记/掩护/隐蔽/奔跑" },
      { key: "hit", label: "自动命中判定" },
      { key: "critFail", label: "自然 1 失手 / 自然 20 重击" },
      { key: "damage", label: "自动掷伤害" },
      { key: "effects", label: "自动应用命中效果" },
    ],
  },
  {
    group: "turn",
    label: "B 回合结算",
    hint: "关闭后回合开始/结束逐个手动",
    items: [
      { key: "ongoing", label: "回合开始持续伤害" },
      { key: "regen", label: "回合开始再生" },
      { key: "saveEnd", label: "回合结束豁免" },
      { key: "deathSave", label: "死亡豁免" },
      { key: "actionBudget", label: "回合动作预算", hint: "标准/移动/次要记账与拦截（移动替标准/次要替移动）" },
      { key: "stateExpire", label: "状态/标记到期自动清除", hint: "回合边界清理「被标记」等带时长状态（独立于灵气开关）" },
    ],
  },
  {
    group: "life",
    label: "C 状态与生命",
    hint: "关闭后对应修正不再自动套用",
    items: [
      { key: "bloodied", label: "重伤/濒死自动标记" },
      { key: "condMods", label: "状态修正自动生效", hint: "倒地/目盲/束缚/震慑…对防御与速度的修正" },
      { key: "damageMods", label: "伤害修正自动应用", hint: "抗力/易伤/免疫/虚体/虚弱减半" },
    ],
  },
  {
    group: "trigger",
    label: "D 触发与光环",
    hint: "借机与反应威能的检测/结算",
    items: [
      { key: "aura", label: "灵气自动结算", hint: "回合开始/结束时灵气内的伤害、治疗、持续、状态自动结算" },
      { key: "oppDetect", label: "借机 / 反应自动检测", hint: "移动/远程威能借机、被命中反应威能自动弹出结算条" },
      { key: "oppResolve", label: "借机 / 反应自动结算", hint: "结算条自动掷骰（关=DM 手填 d20 与伤害）" },
      { key: "provoke", label: "触发动作提示", hint: "回合边界类反应威能（开始/结束其回合触发）日志提示 DM 裁决" },
      { key: "zone", label: "区域效果自动结算", hint: "zone/墙 的进入与轮开始结算" },
    ],
  },
  {
    group: "resource",
    label: "E 资源",
    hint: "",
    items: [{ key: "actionPoint", label: "行动点自动管理" }],
  },
];

export default function SettingsView({ settings, onChange }: Props) {
  /** 不可变地切一个嵌套 auto 开关 */
  const toggleAuto = (group: keyof AutoSettings, key: string) => {
    const cur = settings.auto[group] as Record<string, boolean>;
    onChange({ ...settings, auto: { ...settings.auto, [group]: { ...cur, [key]: !cur[key] } } });
  };

  return (
    <div className="es-view">
      <header className="es-view-head">
        <h2>设置</h2>
        <span className="es-view-sub">界面与偏好</span>
      </header>

      <section className="es-set-card">
        <h3>自动化</h3>
        <p className="es-set-note">默认全部开启；关闭后对应环节退回 DM 手动填写（结算条会展开对应输入项）。</p>
        {AUTO_GROUPS.map((g) => (
          <div key={g.group} className="es-auto-group">
            <div className="es-auto-group-head">
              <span className="es-auto-group-label">{g.label}</span>
              {g.hint && <span className="es-auto-group-hint">{g.hint}</span>}
            </div>
            {g.items.map((it) => {
              const on = (settings.auto[g.group] as Record<string, boolean>)[it.key];
              return (
                <label key={it.key} className={"es-set-row es-auto-row" + (on ? " on" : "")}>
                  <span className="es-auto-toggle" />
                  <span className="es-auto-text">
                    <span className="es-auto-name">{it.label}</span>
                    {it.hint && <span className="es-auto-hint">{it.hint}</span>}
                  </span>
                  <input type="checkbox" checked={on} onChange={() => toggleAuto(g.group, it.key)} />
                </label>
              );
            })}
          </div>
        ))}
      </section>

      <section className="es-set-card">
        <h3>主题色</h3>
        <div className="es-set-row">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.key}
              className={"es-swatch" + (settings.accent === p.key ? " on" : "")}
              onClick={() => onChange({ ...settings, accent: p.key })}
            >
              <span className="es-swatch-dot" style={{ background: p.color }} />
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="es-set-card">
        <h3>棋子圆角</h3>
        <label className="es-set-row">
          <input
            type="range"
            min={0}
            max={30}
            value={settings.tokenCorner}
            onChange={(e) => onChange({ ...settings, tokenCorner: Number(e.target.value) })}
          />
          <span>{settings.tokenCorner}px</span>
        </label>
      </section>

      <section className="es-set-card">
        <h3>网格</h3>
        <label className="es-set-row">
          <input
            type="checkbox"
            checked={settings.showGrid}
            onChange={(e) => onChange({ ...settings, showGrid: e.target.checked })}
          />
          <span>显示地图网格线</span>
        </label>
        <label className="es-set-row">
          <input
            type="checkbox"
            checked={settings.showHpBar}
            onChange={(e) => onChange({ ...settings, showHpBar: e.target.checked })}
          />
          <span>棋子底部血条</span>
        </label>
      </section>

      <section className="es-set-card">
        <h3>车卡器地址</h3>
        <label className="es-set-note">「打开角色卡」将在新标签页打开此地址并把当前角色数据单向带入。默认 dev 地址 http://localhost:5173。</label>
        <input
          className="es-search"
          type="url"
          value={settings.charcraftUrl}
          placeholder="http://localhost:5173"
          onChange={(e) => onChange({ ...settings, charcraftUrl: e.target.value })}
        />
      </section>

      <section className="es-set-card">
        <h3>关于</h3>
        <p className="es-set-note">D&D 4E 遭遇战模拟器（DM 工具型）。怪物与规则数据来自《4E 龙与地下城·规则合集》。设置自动保存在本地浏览器。</p>
      </section>
    </div>
  );
}