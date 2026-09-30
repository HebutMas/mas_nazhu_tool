#!/usr/bin/env python3
"""
把 QQ 群成员的名称导出成 Excel。

数据源：本地 NapCat 的 OneBot 11 接口 get_group_member_list。
只用 openpyxl 一个依赖，其余是标准库。

用法示例：
    # 导出全群成员（默认取群名片）
    python export_names.py --group 123456789 --out "D:\\名单.xlsx"

    # 只要名称里含 "26" 的，并额外保留一个例外
    python export_names.py --group 123456789 --out "D:\\26届.xlsx" \
        --filter 26 --keep 某个要保留的名字 --fallback-nickname

    # 取 QQ 昵称而不是群名片
    python export_names.py --group 123456789 --out "D:\\昵称.xlsx" --field nickname
"""
import argparse
import datetime
import json
import os
import sys
import urllib.request

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

# ---------------- 配色（单色系，最多三色纪律） ----------------
PRIMARY = "1B2A4A"        # 表头底色
NEUTRAL_900 = "37352F"    # 正文
NEUTRAL_200 = "E9E9E8"    # 分隔线
NEUTRAL_100 = "F7F7F5"    # 隔行填充
NEUTRAL_0 = "FFFFFF"
FONT_NAME = "Microsoft YaHei"   # 中文字体；macOS 可换成 "PingFang SC"


def read_config(path):
    """NapCat 的地址和 token。配置文件优先，环境变量可覆盖。"""
    cfg = {"http": "http://127.0.0.1:3000", "token": ""}
    default = os.path.expanduser(os.path.join("~", ".zcode", "skills", "qq-group", "config.json"))
    path = path or default
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cfg.update(json.load(f))
    cfg["http"] = os.environ.get("NAPCAT_HTTP", cfg["http"]).rstrip("/")
    cfg["token"] = os.environ.get("NAPCAT_TOKEN", cfg["token"])
    return cfg


def fetch_members(cfg, group_id):
    req = urllib.request.Request(
        f"{cfg['http']}/get_group_member_list",
        data=json.dumps({"group_id": group_id, "no_cache": True}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {cfg['token']}"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        payload = json.loads(r.read().decode("utf-8"))
    if payload.get("retcode") != 0:
        sys.exit(f"接口返回异常：{payload}")
    return payload["data"]


def clean(v):
    """把 全角空格 / NBSP / 零宽字符 这类"看着有值其实空白"的内容归成 None。

    QQ 名片里确实存在只有不可见字符的名字，不处理会污染统计。
    """
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip().replace("\xa0", "").replace("\u200b", "").replace("\u3000", "")
        if s == "":
            return None
    return v


def main():
    ap = argparse.ArgumentParser(description="导出 QQ 群成员名称到 Excel")
    ap.add_argument("--group", required=True, help="群号")
    ap.add_argument("--out", required=True, help="输出 xlsx 路径")
    ap.add_argument("--field", choices=["card", "nickname"], default="card",
                    help="取哪个字段：card=群名片（群内显示名，默认），nickname=QQ昵称")
    ap.add_argument("--fallback-nickname", action="store_true",
                    help="群名片为空时退回用 QQ 昵称。强烈建议加上：没设群名片的人否则会整条丢失"
                         "（若再叠加 --filter，他们会被当成「不含关键词」筛掉）")
    ap.add_argument("--filter", dest="substr", default=None,
                    help="只保留名称含该子串的条目，例如 26")
    ap.add_argument("--keep", action="append", default=[],
                    help="不含 --filter 子串但要保留的例外，可重复")
    ap.add_argument("--config", default=None, help="NapCat 配置文件路径")
    ap.add_argument("--title", default=None, help="表格标题，默认自动生成")
    args = ap.parse_args()

    group_id = int(args.group)
    cfg = read_config(args.config)
    members = fetch_members(cfg, group_id)
    total = len(members)

    names = []
    for m in members:
        v = clean(m.get(args.field))
        if not v and args.fallback_nickname and args.field == "card":
            v = clean(m.get("nickname"))
        names.append(v or "")
    if args.substr:
        keep = set(args.keep)
        names = [n for n in names if args.substr in n or n in keep]
    names.sort(key=lambda s: (s == "", s))

    # ---------------- 写表 ----------------
    wb = Workbook()
    wb.properties.creator = "qq-group-tool"
    ws = wb.active
    ws.title = "群成员名称"
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 3
    ws.row_dimensions[1].height = 15
    ws.row_dimensions[2].height = 32
    ws.row_dimensions[3].height = 8
    ws.row_dimensions[4].height = 28

    title = args.title or f"群 {group_id} · 成员名称"
    if args.substr:
        title += f"（仅含「{args.substr}」）"
    t = ws.cell(row=2, column=2, value=title)
    t.font = Font(name=FONT_NAME, size=16, color=PRIMARY)

    h = ws.cell(row=4, column=2, value="群名称" if args.field == "card" else "昵称")
    h.fill = PatternFill("solid", fgColor=PRIMARY)
    h.font = Font(name=FONT_NAME, size=11, color="FFFFFF")
    h.alignment = Alignment(horizontal="center", vertical="center")
    h.border = Border(bottom=Side(style="thin", color=NEUTRAL_200))

    for i, n in enumerate(names):
        c = ws.cell(row=5 + i, column=2, value=n or None)
        c.fill = PatternFill("solid", fgColor=NEUTRAL_0 if i % 2 == 0 else NEUTRAL_100)
        c.font = Font(name=FONT_NAME, size=11, color=NEUTRAL_900)
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        ws.row_dimensions[5 + i].height = 22

    width = min(28, max(12, max((len(n) * 1.7 + 2) for n in names) if names else 12))
    ws.column_dimensions["B"].width = width
    ws.freeze_panes = "B5"

    r = 5 + len(names) + 1
    for line in [
        f"数据来源：本地 NapCat（OneBot 11 接口 get_group_member_list），群 {group_id}。"
        f"导出时间：{datetime.datetime.now():%Y-%m-%d %H:%M}。",
        f"共 {len(names)} 条，按名称排序。"
        + (f"（已按「含 {args.substr}」筛选，原始 {total} 条）" if args.substr else ""),
    ]:
        c = ws.cell(row=r, column=2, value=line)
        c.font = Font(name=FONT_NAME, size=9, color="8C8A84")
        r += 1

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    wb.save(args.out)
    print(f"已生成：{args.out}")
    print(f"条数：{len(names)}（原始 {total}）")

    # ---------------- 自查 ----------------
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  {detail}" if not cond else ""))
        ok = ok and cond

    wbv = load_workbook(args.out)
    wsv = wbv.active
    vals = [wsv.cell(row=i, column=2).value for i in range(5, 5 + len(names))]
    check("行数与接口一致", len(vals) == len(names), f"{len(vals)} vs {len(names)}")
    check("内容逐条一致", sorted((v or "") for v in vals) == sorted(names))
    check("已排序", [(v or "") for v in vals] == sorted((v or "") for v in vals))
    if args.substr:
        keep = set(args.keep)
        check(f"全部含「{args.substr}」或为例外", all(args.substr in (v or "") or v in keep for v in vals))
    check("无残留不可见字符", all(v == clean(v) for v in vals if v))
    check("表头样式完整", wsv.cell(row=4, column=2).fill.fgColor.rgb not in (None, "00000000"))
    print("自查：" + ("全部通过" if ok else "存在失败项"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
