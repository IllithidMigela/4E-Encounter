#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从「怪物手册总表.xlsx」的『总表』sheet 生成怪物分类白名单 creature-class.json。

用法: python scripts/build-creature-class.py <xlsx路径> <输出json路径>

白名单以「名称」为键，为每个命中怪物提供权威的 role/origin/category/species，
运行时用它覆盖 monsterParse 的启发式解析结果（未命中名称保持解析值）。
"""
import sys, json, re
from collections import Counter
import openpyxl

ROLE_MAP = {"伏击": "伏兵"}                       # 总表「伏击」→ 应用「伏兵」
VALID_ROLES = {phantom for phantom in ("伏兵", "护卫", "蛮战", "游击", "控制", "远程")}
ORIGIN_MAP = {"影界": "暗影界", "妖精界": "精界"}   # 总表「影界」→ 应用「暗影界」
VALID_ORIGINS = {"自然界", "精界", "元素界", "星界", "异界", "暗影界"}
ROOTS = {"类人生物", "魔法兽", "野兽", "活化生物"}          # 类别根
# 括号内有意义亚型（火/水/气/土系等元素词归界域、矮人等种族词归种群、目盲/坐骑等限定词不计）
SUBTYPES = {"鳞爪类", "不死生物", "龙", "巨人", "恶魔", "魔鬼", "蜘蛛",
            "植物", "构装体", "变形生物", "泥型怪", "活体构装", "天使", "荒神"}
CATS = ROOTS | SUBTYPES                            # 允许发出的全部类别
SPECIES_JUNK = {"苏", "件"}                        # 总表缺字残渣，丢弃


def root_of(cat):
    """类别根：取「（/(」之前、或首个「，」之前的主体（如 魔法兽（水生，水系）→ 魔法兽）。"""
    if not cat:
        return ""
    head = re.split(r"[（(]", cat, maxsplit=1)[0]
    return head.split("，")[0].strip()


def category_of(cat_text):
    """把总表「生物类别」解析为一个类别：括号内是已知亚型则用（首个已知亚型），否则用根。
    例：类人生物（恶魔）→恶魔；魔法兽（龙）→龙；类人生物（矮人）→类人生物；野兽→野兽；
    组合值「魔法兽（寒系，龙）」「类人生物（火系，巨人）」→ 取首个已知亚型 龙/巨人（元素词无亚型信息）。"""
    root = root_of(cat_text)
    if root == "活体生物":            # 笔误：活体生物 即 活化生物
        root = "活化生物"
    cat = root if root in ROOTS else ""
    m = re.search(r"[（(]([^）)]*)[）)]", cat_text)
    if m:
        for tok in re.split(r"[，,]", m.group(1)):
            tok = tok.strip()
            if tok in SUBTYPES:
                cat = tok
                break
    return cat


def tier_of(text):
    """把总表「类型」列解析为 (tier, 副标签s)。
    例：头目→(头目,[])；精英头目→(精英,[头目])；杂兵→(杂兵,[])；坐骑/空→(None,[])。"""
    t = (text or "").strip()
    if not t or t == "坐骑":
        return None, []
    head = "头目" if "头目" in t else None
    main = t.replace("头目", "").strip()
    if main in ("杂兵", "精英", "强者"):
        return main, ([head] if head else [])
    if main == "" and head:
        return "头目", []
    return main or head or None, []


def majority(vals):
    """取出现次数最多的非空归一化值；无有效值返回 ''。"""
    c = Counter(v for v in vals if v != "")
    return c.most_common(1)[0][0] if c else ""


def main():
    src, dst = sys.argv[1], sys.argv[2]
    wb = openpyxl.load_workbook(src, read_only=True)
    ws = wb["总表"]
    rows = list(ws.iter_rows(values_only=True))
    C = {n: j for j, n in enumerate(rows[0])}

    # 按名称聚合各字段的非空候选 + 来源说明（用于 coverage 报告）
    agg = {}
    for r in rows[1:]:
        nm = (r[C["名称"]] or "").strip()
        if not nm:
            continue
        a = agg.setdefault(nm, {"role": [], "origin": [], "category": [], "species": [], "tier": [], "tierTags": []})
        role = ROLE_MAP.get((r[C["职能"]] or "").strip(), (r[C["职能"]] or "").strip())
        origin = ORIGIN_MAP.get((r[C["界域"]] or "").strip(), (r[C["界域"]] or "").strip())
        cat = category_of((r[C["生物类别"]] or "").strip())
        spc = (r[C["生物种群"]] or "").strip()
        tier, tags = tier_of((r[C["类型"]] or "").strip())
        if role: a["role"].append(role)
        if origin: a["origin"].append(origin)
        if cat: a["category"].append(cat)
        if spc and spc not in SPECIES_JUNK: a["species"].append(spc)
        if tier: a["tier"].append(tier)
        for tag in tags: a["tierTags"].append(tag)

    out, stats = {}, {"names": 0, "role": 0, "origin": 0, "category": 0, "species": 0, "tier": 0}
    for nm, a in agg.items():
        rec = {}
        role = majority(a["role"])
        if role in VALID_ROLES:
            rec["role"] = role; stats["role"] += 1
        origin = majority(a["origin"])
        if origin in VALID_ORIGINS:
            rec["origin"] = origin; stats["origin"] += 1
        category = majority(a["category"])
        if category in CATS:
            rec["category"] = category; stats["category"] += 1
        species = majority(a["species"])
        if species:
            rec["species"] = species; stats["species"] += 1
        tier = majority(a["tier"])
        if tier:
            rec["tier"] = tier; stats["tier"] += 1
            tg = list(dict.fromkeys(a["tierTags"]))
            if tg:
                rec["tierTags"] = tg
        if rec:
            out[nm] = rec
            stats["names"] += 1

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0, separators=(",", ":"))

    print("wrote", dst)
    print("total rows in sheet:", len(rows) - 1)
    print("whitelist names:", stats["names"])
    for k in ("role", "origin", "category", "species", "tier"):
        print("  %-9s override entries: %d" % (k, stats[k]))


if __name__ == "__main__":
    main()