# 怪物库导入报告（旧数据 与 最新怪物数据 格式统一）

生成时间：2026-09-19T06:04:14.938Z

## 一、格式差异（旧 vs 新）

| 维度 | 旧数据 creature.json | 新数据 怪物数据/*.json | 统一后 |
| --- | --- | --- | --- |
| 形态 | 单文件数组 | 每怪物一个 JSON 文件（TiddlyWiki 导出） | 单文件数组 |
| 顶层字段 | id/name/nameEn/category/tags/source/sourceText/fields/wiki | title/text/level/role/specialty-role/size/origin/creature-type/xp/… | 统一为 id/name/nameEn/category/tags/source/sourceText + 7 个结构化字段 |
| 正文 | sourceText 已渲染（值已烘焙） | text 含 `{{!!字段}}` 模板占位 | 全部已渲染、无占位 |
| 生命值标签 | `''生命值''` | `''HP''` | 统一 `''生命值''`（解析器依赖） |
| tags | 数组 | 字符串 | 统一数组 |
| 结构化元数据（等级/角色/体型/起源/类型/XP） | 无，埋于 HTML | 有顶层字段 | 旧数据从 HTML 提取补齐，两库一致 |
| 额外字段 | fields/wiki/magazine | created/creator/modified/…（wiki 元数据） | 仅保留 magazine（旧库有则留），其余为库无关元数据不保留 |

## 二、导入统计

| 项目 | 数量 |
| --- | --- |
| 旧库条目 | 205 |
| 新数据文件 | 928（唯一标题 908） |
| 新库内部重名（同 title） | 20 个（保留更完整版本） |
| 新旧 title 冲突 | 4 个 |
| 合并后总数 | 1112 |
| 解析成功（可加入遭遇） | 986 |
| 解析失败（召唤物/模板等，仅存档） | 126 |

## 三、新旧 title 冲突处理明细

| 名称 | 处理 | 原因 |
| --- | --- | --- |
| 鲨蜥兽 Bulette | 两条保留 | 旧库为召唤物属性（非完整属性块），数据不同；旧条目 id 加「（召唤）」后缀保留（旧源 HoF） |
| 六臂蛇魔 Marilith | 合并（旧→新） | 旧库为完整属性块，与新库为同一只怪物，保留新数据（旧源 MM / 新源 MM） |
| 位移兽 Displacer Beast | 两条保留 | 旧库为召唤物属性（非完整属性块），数据不同；旧条目 id 加「（召唤）」后缀保留（旧源 Dragon） |
| 凶暴熊 Dire Bear | 两条保留 | 旧库为召唤物属性（非完整属性块），数据不同；旧条目 id 加「（召唤）」后缀保留（旧源 HoF） |

## 四、新库内部重名处理明细（保留更完整版本）

| 名称 | 保留 | 丢弃 |
| --- | --- | --- |
| 高斯眼魔 Beholder Gauth | MM/013-高斯眼魔 Beholder Gauth.json | MM/334-高斯眼魔 Beholder Gauth.json |
| 独眼巨人打击者 Cyclops Crusher | MM/023-独眼巨人打击者 Cyclops Crusher.json | MM/357-独眼巨人打击者 Cyclops Crusher.json |
| 巴布魔 Babau | MM/678-巴布魔 Babau.json | MM/030-巴布魔 Babau.json |
| 深渊剔骨魔 Abyssal Eviscerator | MM/032-深渊剔骨魔 Abyssal Eviscerator.json | MM/369-深渊剔骨魔 Abyssal Eviscerator.json |
| 血魔龙兽 Bloodseeker Drake | MM/067-血魔龙兽 Bloodseeker Drake.json | MM/422-血魔龙兽 Bloodseeker Drake.json |
| 灰矮人斥候 Duergar Scout | MM/430-灰矮人斥候 Duergar Scout.json | MM/077-灰矮人斥候 Duergar Scout.json |
| 灰矮人守卫 Duergar Guard | MM/078-灰矮人守卫 Duergar Guard.json | MM/429-灰矮人守卫 Duergar Guard.json |
| 霜巨人 Frost Giant | MM/480-霜巨人 Frost Giant.json | MM/122-霜巨人 Frost Giant.json |
| 霜泰坦 Frost Titan | MM/124-霜泰坦 Frost Titan.json | MM/482-霜泰坦 Frost Titan.json |
| 死誓豺狼人 Deathpledged Gnoll | MM/134-死誓豺狼人 Deathpledged Gnoll.json | MM/486-死誓豺狼人 Deathpledged Gnoll.json |
| 耶诺古之牙 Fang of Yeenoghu | MM/487-耶诺古之牙 Fang of Yeenoghu.json | MM/136-耶诺古之牙 Fang of Yeenoghu.json |
| 豺狼人吞噬者 Gnoll Gorger | MM/489-豺狼人吞噬者 Gnoll Gorger.json | MM/137-豺狼人吞噬者 Gnoll Gorger.json |
| 侏儒熵法师 Gnome Entropist | MM/491-侏儒熵法师 Gnome Entropist.json | MM/145-侏儒熵法师 Gnome Entropist.json |
| 铁魔像 Iron Golem | MM/159-铁魔像 Iron Golem.json | MM/501-铁魔像 Iron Golem.json |
| 绿泥怪 Green Slime | MM/216-绿泥怪 Green Slime.json | MM/572-绿泥怪 Green Slime.json |
| 黑布丁 Black Pudding | MM/218-黑布丁 Black Pudding.json | MM/569-黑布丁 Black Pudding.json |
| 锈蚀怪 Rust Monster | MM/578-锈蚀怪 Rust Monster.json | MM/245-锈蚀怪 Rust Monster.json |
| 幼年锈蚀怪集群 Young Rust Monster Swarm | MM/247-幼年锈蚀怪集群 Young Rust Monster Swarm.json | MM/579-幼年锈蚀怪集群 Young Rust Monster Swarm.json |
| 战蜥人打击者 Troglodyte Thrasher | MM/265-战蜥人打击者 Troglodyte Thrasher.json | MM/609-战蜥人打击者 Troglodyte Thrasher.json |
| 刃狂巨魔 Bladerager Troll | MM/269-刃狂巨魔 Bladerager Troll.json | MM/613-刃狂巨魔 Bladerager Troll.json |

## 五、解析失败条目（仅存档、不可加入遭遇）

- 蝙蝠 Bat（AP）
- 渡鸦 Raven（AP）
- 工匠矮人 Crafter Homunculus（AP）
- 界魔 Bound Demon（AP）
- 老鼠 Rat（AP）
- 猎鹰 Falcon（AP）
- 猫 Cat（AP）
- 猫头鹰 Owl（AP）
- 蛇 Serpent（AP）
- 书鬼 Book Imp（AP）
- 幼龙 Dragonling（AP）
- 蜘蛛 Spider（AP）
- 哀悼侍女 Mourning Handmaiden（Dragon）
- 暗黑卵 Blackspawn Darkling（Dragon）
- 奥术精灵 Arcane Wisp（Dragon）
- 白眼乌鸦 White-Eyed Crow（Dragon）
- 冰魔蝠 Ice Mephit（Dragon）
- 蟾蜍 Toad（Dragon）
- 超小胶质怪 Tiny Gelatinous Cube（Dragon）
- 沉思幽灵 Thought Phantom（Dragon）
- 道路行者 Way Walker（Dragon）
- 毒钉绿卵 Greenspawn Banespike（Dragon）
- 独角兽战马 Unicorn Destrier（Dragon）
- 短牙灰卵 Grayspawn Shortfang（Dragon）
- 翡翠马 Jade Horse（Dragon）
- 疯言宠物 Gibbering Pet（Dragon）
- 浮游珊瑚虫 Floating Polyp（Dragon）
- 缚魂 Bound Soul（Dragon）
- 构装犬 Canine Construct（Dragon）
- 华丽之鹰 Gallant Hawk（Dragon）
- 獾 Badger（Dragon）
- 灰毒猫 Kivit（Dragon）
- 混沌碎晶 Chaos Shard（Dragon）
- 火魔蝠 Fire Mephit（Dragon）
- 火蜥蜴 Fire Lizard（Dragon）
- 火焰徐风 Flame Zephyr（Dragon）
- 尖啸蜥蜴 Z'tal（Dragon）
- 烈火红卵 Redspawn Spitfire（Dragon）
- 烈焰头骨 Blazing Skull（Dragon）
- 灵闪蓝卵 Bluespawn Nimblespark（Dragon）
- 罗刹妖之爪 Rakshasa Claw（Dragon）
- 魅声甲虫 Hurrum（Dragon）
- 秘法眼 Arcane Eye（Dragon）
- 冥想精灵 Muse Sprite（Dragon）
- 泥形怪 Ooze（Dragon）
- 气魔蝠 Air Mephit（Dragon）
- 闪电蜥蜴 Lightning Lizard（Dragon）
- 石之鸡蛇 Stone Fowl（Dragon）
- 食腐鸟 Kes'trekel（Dragon）
- 踏雪白卵 Whitespawn Snowstepper（Dragon）
- 天堂战马 Celestial Warhorse（Dragon）
- 头骨 Skull（Dragon）
- 土魔蝠 Earth Mephit（Dragon）
- 微气元素 Least Air Elemental（Dragon）
- 微土元素 Least Earth Elemental（Dragon）
- 位移兽 Displacer Beast（召唤）（Dragon）
- 嗡鸣平衡者 Duodrone Balancer（Dragon）
- 希泰克 Sitak（Dragon）
- 小树根 Rootling（Dragon）
- 小眼魔 Beholderkin（Dragon）
- 虚体手 Disembodied Hand（Dragon）
- 杨克 Jank（Dragon）
- 夜魔 Satyr of the Night（Dragon）
- 阴影化身 Shadow Incarnate（Dragon）
- 鹦鹉 Parrot（Dragon）
- 幽灵 Specter（Dragon）
- 幽灵守护者 Spectral Protector（Dragon）
- 有翼灵蛇 Wrab（Dragon）
- 鼬鼠 Weasel（Dragon）
- 预警蜥蜴 Critic Lizard（Dragon）
- 月光灵球 Moon Wisp（Dragon）
- 侦察矮人 Scout Homunculus（Dragon）
- 大地伙伴 Earth-Friend（DSH）
- 风暴泰坦战士 Storm Titan Warrior（HoEC）
- 风魔 Djinnling（HoEC）
- 寒霜泰坦战士 Frost Titan Warrior（HoEC）
- 活体微风 Living Zephyr（HoEC）
- 火系泰坦战士 Fire Titan Warrior（HoEC）
- 火系亚空士兵 Fire Archon Grunt（HoEC）
- 火之巨兽 Fire Monolith（HoEC）
- 气系亚空士兵 Air Archon Grunt（HoEC）
- 气之巨兽 Air Monolith（HoEC）
- 水魔 Maridan（HoEC）
- 水系亚空士兵 Water Archon Grunt（HoEC）
- 水之巨兽 Water Monolith（HoEC）
- 苏斯塔尔战车-Chariot of Sustarre（HoEC）
- 土魔 Daolanin（HoEC）
- 土系泰坦战士 Earth Titan Warrior（HoEC）
- 土系亚空士兵 Earth Archon Grunt（HoEC）
- 土之巨兽 Earth Monolith（HoEC）
- 炎魔 Efreetkin（HoEC）
- 隐形追击者 Invisible Stalker（HoEC）
- 雏蓝龙 Blue Dragon Wyrmling（HoF）
- 毒蝎 Venomous Scorpion（HoF）
- 灰熊 Grizzly Bear（HoF）
- 巨大眼镜蛇 Giant Cobra（HoF）
- 猎虎 Hunting Tiger（HoF）
- 猛禽比蒙 Raptor Behemoth（HoF）
- 沙漠巨鹏 Desert Roc（HoF）
- 沙漠猎鹰 Desert Hawk（HoF）
- 鲨蜥兽 Bulette（召唤）（HoF）
- 头狼 Pack Wolf（HoF）
- 蟋蟀人 Fiddling Grig（HoF）
- 小精灵 Sprite（HoF）
- 小雅灵侍从 Coure Attendant（HoF）
- 凶暴狮 Dire Lion（HoF）
- 凶暴熊 Dire Bear（召唤）（HoF）
- 刺魔侍从 Spined Devil Lackey（HoFK）
- 枯霜树人守护者 Frostblight Treant Protector（HoFK）
- 狼动物伙伴 Wolf Animal Companion（HoFK）
- 深狱炼魔仆人 Pit Fiend Servitor（HoFK）
- 菘蓝守卫 Wood Woad Guardian（HoFK）
- 熊动物伙伴 Bear Animal Companion（HoFK）
- 哀誓魔 Sorrowsworn（HoS）
- 暗影骷髅 Shadow Skeleton（HoS）
- 暗影潜伏者 Shadow Lurk（HoS）
- 暗影凶兽 Shadow Brute（HoS）
- 暗影野兽 Shadow Beast（HoS）
- 暗影幽魂 Shadow Wraith（HoS）
- 厄运巨物 Doom Hulk（HoS）
- 黑暗爬行者 Dark Creeper（HoS）
- 噬魂者 Soul Eater（HoS）
- 阴暗凶兽 Gloom Beast（HoS）
- 阴影之蛇 Shadow Serpent（HoS）
- 影鸦 Shadow Raven（HoS）
- 夸塞魔伙伴 Quasit Companion（MME）

## 六、遗留说明

- 杂兵（HP 1）解析修复：monsterParse.ts 已改为 bloodied 兜底 ≥1，杂兵可正常加入遭遇。
- 新库正文的 `''豁免''/''行动点''`、`''感官''` 等行解析器暂不消费，不影响属性块主数据。
- 解析失败项多为召唤物/模板（旧库原有行为），如需使用可后续单独补数据。