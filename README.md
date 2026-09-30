# QQ 群纳新工具（可接入 AI，执行踢人等操作）

把 QQ 群管理能力接给 AI 助手：让 AI 帮你查群、找人、**踢人**，以及把群成员名单导出成 Excel 做纳新统计。

面向高校战队/社团的纳新场景（如「山海机甲」这类招新群）：一堆人改好了「专业+年级+姓名」格式的群名片，需要按届筛选、导出、清退。

---

## 它由什么组成

```
QQ 客户端 (QQNT)
   └─ NapCat 注入其中，把 QQ 能力暴露成 OneBot 11 标准 HTTP 接口
        └─ 本仓库的脚本调这个接口
             ├─ skill/qq.mjs          群管理 CLI（AI 通过它执行踢人等操作）
             └─ export/export_names.py 成员名单导出 Excel
```

**没有 QQ 官方接口可用。** 个人号没有公开的"读群成员""踢人"API，所以数据是靠 NapCat Hook 真实客户端拿到的——这也是本工具存在封号风险的根本原因。

## 目录

```
skill/                    AI 接入用的 skill 本体
  SKILL.md                 技能描述（AI 读这个来决定何时调用）
  qq.mjs                   命令行实现，零依赖，Node 18+
  config.example.json      配置模板
  test/                    离线自测（模拟 OneBot 服务，不需要真 QQ 号）
setup/
  NAPCAT_SETUP.md          NapCat 安装、登录、开启接口的完整步骤
  start-napcat.bat         Windows 启动脚本（改顶部三行即可）
export/
  export_names.py          群成员名单导出 Excel（只依赖 openpyxl）
third_party/napcat/       第三方组件（NapCat 官方发布包，附完整许可证）
  NapCat.Shell.zip         NapCat v4.18.28 官方原始包，未做任何修改
  LICENSE-NapCat.txt       其许可证完整原文
  NOTICE.md                来源 / 版权 / 版本 / SHA256 说明
```

> `third_party/napcat/` 里的东西**不是**本仓库的作品，适用其自身许可证，**仅限非商业用途**。分发它是有强制条件的，部署或再分发前请先读 [third_party/napcat/NOTICE.md](third_party/napcat/NOTICE.md)。

---

## 快速开始

1. **装 NapCat 并登录** → 本仓库已附带 NapCat 官方包，把 `third_party/napcat/NapCat.Shell.zip` 解压到固定目录（如 `D:\NapCat`）即可，不需要另外去下载。详细步骤和三个常见坑见 [setup/NAPCAT_SETUP.md](setup/NAPCAT_SETUP.md)，目标是确认 `http://127.0.0.1:3000` 通了。
2. **配好 CLI** → 复制配置模板并填入你的 token：

   ```bash
   cp skill/config.example.json ~/.zcode/skills/qq-group/config.json
   # 编辑里面的 http 和 token
   ```

3. **验证**：

   ```bash
   node ~/.zcode/skills/qq-group/qq.mjs doctor
   ```

   期望输出：`✔ NapCat http://127.0.0.1:3000 已连接，账号 xxx，online=true，模式=可写，已启用写操作=kick`

## 装到 AI 客户端

`skill/` 目录就是一个标准的 Agent Skill。放到客户端的技能目录即可，比如 ZCode / Claude Code：

```bash
cp -r skill ~/.zcode/skills/qq-group
```

> 客户端重启后才会出现在技能列表里。

装好后直接对 AI 说人话就行，例如"把 XX 群里的张三踢了"、"帮我看看这个群有多少人"。

---

## 命令

```bash
# —— 读操作（无限制，随便跑）——
qq.mjs doctor                    # 连接与账号状态
qq.mjs groups [关键词]           # 群列表：群号 / 群名 / 人数
qq.mjs find <群> <关键词>        # 在群里找成员（只回匹配项）
qq.mjs info <群> <目标>          # 角色与禁言状态
qq.mjs members <群>              # 成员列表（费 token，尽量别用）

# —— 写操作 ——
qq.mjs kick <群> <目标> [--reject] [--confirm]   # 踢人
```

`<群>` 和 `<目标>` 都接受**群号/QQ号**或**名称关键词**，不需要先查 ID。这是刻意的设计：让 AI 不必为了拿 QQ 号而把整个成员表拉进上下文。

### 被默认关掉的写操作

`mute`（禁言）、`admin`（设管理员）、`card`（改群名片）、`rename`（改群名）、`wholeban`（全员禁言）、`dismiss`（解散群）——这些命令**存在但默认禁用**，调用会被拒绝。

想启用某个，改 `config.json`：

```json
{ "allowedWrites": ["kick", "mute"] }
```

`dismiss` 这类不可逆接口留在那里却用不到，就是纯风险面，所以默认摘掉。

---

## 安全设计

这个工具会真的把人踢出群，所以有几道闸门是刻意设计的：

**一、写操作逐次确认。** 所有写命令必须带 `--confirm` 才执行，不带就**直接拒绝、一个请求都不发**给 QQ。配套的 skill 文档明确规定：AI 必须先跑 `--dry-run` 把结果给用户看，得到明确同意后才能加 `--confirm`。含糊的"随便你"不算同意。

**二、命令白名单。** 只有列在 `allowedWrites` 里的写命令存在（默认只有 `kick`）。

**三、全局只读开关。** `readonly: true` 时所有写操作一律拒绝，适合刚接管一群、只想先观察的阶段。

**四、内置保护。**
- 群主：拒绝操作（踢不掉，也不该踢）
- 机器人自己：拒绝踢自己
- **重名歧义：拒绝执行并列出候选**，让用户确认，绝不自己挑一个——踢错人不可逆
- 所有写操作追加到 `audit.log`，出事了能回溯

**五、查询永不截断成假数据。** `members` 受 `listLimit` 限制并明确提示"只显示前 N 条"，不会让人误以为是全部。

### 写操作后请自查

接口返回 `retcode:0` 只代表请求被接受，不代表真生效。用 `info` 复核（它读的是实时值）：

```bash
qq.mjs info <群> <目标>    # → 张三(12345) ← 测试群(987654)：member，禁言剩余 87s
```

---

## 导出成员名单

```bash
# 导出全群（默认取群名片）
python export/export_names.py --group 123456789 --out "D:\名单.xlsx"

# 只保留名称含 "26" 的，并额外保留一个例外；名片为空时退回昵称
python export/export_names.py --group 123456789 --out "D:\26届.xlsx" \
    --filter 26 --keep 某人姓名 --fallback-nickname
```

**`--fallback-nickname` 建议总是加上。** 群里总有人没设群名片——不加这个选项，他们不但名字会空着，叠加 `--filter` 时还会被当成"不含关键词"整条筛掉，静默丢人。

脚本内部做了几件容易出错的事：

- **不可见字符清洗**：QQ 名片里存在只由全角空格、NBSP 组成的"空白名字"，肉眼看有值、程序看是空。不清洗会污染统计。
- **导出后自动自查**：重新读回文件，逐条比对接口数据、检查排序、检查筛选合规，全部通过才返回 0。
- **一次性完成**：数据从接口直接落到文件，不经过 AI 上下文。445 人的名单如果经由模型转手就是几万 token。

---

## 离线自测

不需要真实 QQ 号，用内置的模拟 OneBot 服务跑全部逻辑（含重名歧义、群主保护、参数换算、白名单、退出码）：

```bash
node skill/test/test.mjs     # 期望 70 通过 0 失败
```

---

## 风险与合规

**请先读完再决定用不用。**

- 这是**第三方协议实现**，不是腾讯官方方案。用它跑 QQ 号**存在被冻结或封号的风险**。本项目不承担任何责任。
- **务必用小号。** 不要用主号——你的 QQ 号往往还绑着支付、游戏、其他用 QQ 登录的服务，一旦封禁损失远超"不能聊天"。
- 冻结通常分档：社交风控/临时冻结验证手机即可解，但**反复触发会逐级加重**。别把"封了能解"当成保险。
- NapCat 官方给的隔离建议是：*「避免在同一 IP/设备上同时登录 Bot 账号与常用账号，以防常用账号受到异常影响」*。
- **踢人要求机器人账号在目标群是管理员或群主。** 全新小号当不上管理员——这是本工具在真实群里落地的最大约束，请提前规划用哪个号。
- 想走完全合规的路，只能用 QQ 官方开放平台，但它**不提供任意群的成员管理与踢人能力**，满足不了纳新清退的需求。

**不要把 `config.json`、`audit.log`、导出的名单提交到公开仓库。** 前者含可操作用户账号的访问令牌，后者含群成员个人信息。仓库已提供 `.gitignore` 覆盖这些文件。

---

## 常见问题

**双击 `start-napcat.bat` 没反应。** 脚本必须是 **CRLF 换行**且**不带 UTF-8 BOM**，否则 cmd 会解析失败。用编辑器另存为 "Windows (CRLF)"、编码选 "UTF-8 无 BOM"。

**NapCat 启动后立刻退出。** 本机已有 QQ 在运行，单实例冲突。脚本开头的 `taskkill` 就是处理这个的，先手动退掉 QQ 再启动。

**命令成功但没生效。** 用 `info` 复核。另外注意字段名是 `shut_up_timestamp`，且要 `no_cache: true` 才读到实时值。

**导出的 `sex` 全是 unknown、`qq_level` 全是 0。** NapCat 这个接口本身不填这些字段，不是调用方问题。做统计别依赖这两列。

**Excel 打开着文件时导出失败**（`PermissionError`）。Windows 文件独占锁，先关掉 Excel。这不是脚本的 bug，绕不过去。

---

## 许可证

本仓库自身代码可自由使用。

但 **`third_party/napcat/` 里的 NapCat 是另一回事**，它使用的是作者自制的 *Limited Redistribution License*，不是宽松协议：

- 再分发**允许**，但**必须附带完整许可证原文并标注来源与版权** —— 所以本仓库把 `LICENSE-NapCat.txt` 和 `NOTICE.md` 一起放进去了。
- **仅限非商业用途。** 如果要把本项目用于商业场景，必须自行向 NapCat 作者取得授权。
- 本仓库未修改 NapCat 任何文件，仅原样附带其官方发布包；包内 `NOTICE.md` 记录了 SHA256，可自行核对。

> 顺带一提：NapCat 官方发布包里**并不包含**它自己的 LICENSE 文件。所以那份许可证文本是本仓库补上的——缺了它就构成违规分发。

## 技术要点备查

- 接口：OneBot 11，`POST http://127.0.0.1:3000/<action>`，`Authorization: Bearer <token>`，响应信封含 `status` / `retcode` / `data`。
- 核心动作：`get_group_list`、`get_group_member_list`、`get_group_member_info`、`set_group_kick`、`set_group_ban`。
- `no_cache: true` 强制实时拉取，否则可能拿到缓存快照。
- 取群成员实时状态要看 `shut_up_timestamp`（不是 `shutup_time`）。
- NapCat 对 QQ 是**内存补丁**（`NapCatWinBootHook.dll` 拦截 `package.json` 读取），不改磁盘上的 QQ 安装，卸载删目录即可。
- 建议把 WebUI 和 OneBot 接口都绑 `127.0.0.1`。NapCat 默认 `::`（所有网卡），暴露到局域网等于把踢人权限交给别人。
