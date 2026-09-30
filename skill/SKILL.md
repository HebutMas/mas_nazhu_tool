---
name: qq-group
description: Manage QQ groups through a local NapCat/OneBot v11 instance — kick or mute members, set admins, change group cards and names, whole-group mute, dismiss a group, list groups, and find a member's QQ number. Use when the user asks to moderate a QQ group, remove/mute someone in QQ, look up a QQ group member, or asks who is in a QQ group. Requires NapCat running locally (see doctor).
---

# QQ 群管理

通过本地 NapCat（OneBot v11）管理 QQ 群。所有命令输出都刻意保持单行，避免把成员表灌进上下文。

```bash
node ~/.zcode/skills/qq-group/qq.mjs <命令>
```

## 先跑 doctor

```bash
node ~/.zcode/skills/qq-group/qq.mjs doctor
```

失败就是 NapCat 没跑或地址不对，不要继续尝试其他命令，把报错原样告诉用户。

如果 NapCat 没跑，让它启动（会自动快速登录，不需要扫码，也不要管理员权限）：

```bash
cmd //c "D:\NapCat\start-napcat.bat"
```

启动后等约 20 秒再跑 doctor。NapCat 只监听 `127.0.0.1:3000`（OneBot HTTP）。

## 硬规则：写操作必须先经用户同意

**这个 skill 只启用了「踢人」和「读取」。** `config.json` 的 `allowedWrites` 只有 `kick`；`mute`、`admin`、`card`、`rename`、`wholeban`、`dismiss` 已被禁用，调用会被直接拒绝。不要为了绕开而改配置或设环境变量——用户明确说过只用得到踢人和读取。

踢人**一律先问用户，得到同意前不许执行**。流程固定为两步，不要跳步、不要合并：

1. 先跑 `--dry-run`，把输出**原样**给用户看（它已经含被踢人的 QQ 号和昵称）。
2. 用户明确同意这一次操作后，才加 `--confirm` 重跑。

用户没表态、回答含糊、或者只说了"随便你"这类话，都算**没有同意**——停下来问清楚。

CLI 层面已经强制：写命令不带 `--confirm` 会被直接拒绝，不会发请求给 QQ。所以不要为了"让它跑起来"而习惯性加 `--confirm`。

批量踢人（"把这几个人都踢了"）也要先 `--dry-run` 列出全部名单让用户过目，得到同意后逐个 `--confirm` 执行。

## 省 token 的硬规则

1. **找成员一律用 `find`，不要用 `members`。** `members` 会把整个群成员表打出来，500 人群就是几万 token；`find` 只回匹配项。
2. **永远不要为了拿 QQ 号而先拉成员表。** 直接把昵称交给 `kick`/`mute`，解析在本地做。
3. **不要加 `--json`**，除非真的要用脚本处理返回值。默认的单行输出就是给你看的。
4. 一次只调一条命令，不要为了"确认"重复调用。操作结果里已经包含被操作人的 QQ 号和昵称。

## 命令

读操作（无限制）：

```bash
qq.mjs doctor                          # 连接与账号状态
qq.mjs groups [关键词]                 # 群列表：群号 / 群名 / 人数
qq.mjs find <群> <关键词>              # 在群里找成员（推荐）
qq.mjs info <群> <目标>                # 角色与禁言状态
qq.mjs members <群>                    # 成员列表（费 token，尽量别用）
```

写操作（**目前只有 kick 启用**）：

```bash
qq.mjs kick <群> <目标> [--reject]     # 踢人；--reject 同时拒绝其再加群
```

以下命令**已禁用**，调用会被拒绝：`mute`（禁言）、`admin`（设管理员）、`card`（改群名片）、`rename`（改群名）、`wholeban`（全员禁言）、`dismiss`（解散群）。用户明确说过只用得到踢人，不要试图放开。

`<群>` 和 `<目标>` 都接受**群号/QQ号**或**名称关键词**，不需要先查 ID。

## 遇到歧义就停下来问

目标是名字时，如果匹配到多个人，CLI 会以退出码 2 退出，并列出候选（QQ号 + 昵称 + 角色）。这时候**不要自己挑一个**，把候选交给用户确认。踢错人不可逆。

## 踢人的额外要求

名字不确定或匹配到多个人时，CLI 会拒绝并列候选，**这种情况必须把候选交给用户确认**，不要自己挑。名字明确、单个人、且用户已同意时，可直接 `--confirm`。

```bash
qq.mjs kick 测试群 张三 --dry-run                  # 先看要动谁
qq.mjs kick 测试群 张三 --confirm                  # 用户同意后再执行
```

`--reject` 会同时拒绝对方再次加群，属于加重操作。用户没明确要求时**不要**加。

## 内置保护

- 群主：拒绝操作（踢不掉，也不该踢）。
- 机器人自己：拒绝踢自己。
- 管理员：允许操作但会警告可能失败。
- 所有 kick/mute/admin/dismiss 都会追加到 `~/.zcode/skills/qq-group/audit.log`。

## 配置

默认连 `http://127.0.0.1:3000`，默认**只读**。改地址、关只读、加 access token：

```bash
cp ~/.zcode/skills/qq-group/config.example.json ~/.zcode/skills/qq-group/config.json
```

或用环境变量 `NAPCAT_HTTP` / `NAPCAT_TOKEN` / `QQ_GROUP_READONLY`（`0` 表示可写）。

## 只读模式（第二道闸门）

`readonly: true` 时所有写操作一律拒绝；查询命令正常可用，`--dry-run` 也仍然可用（它没有副作用）。

这是比 `allowedWrites` 更粗的一道闸门，用来整体冻结写操作。`doctor` 会同时显示当前模式和已启用的写操作。

遇到"只读模式已开启"或"已禁用 xxx"的报错时，**不要**自己去改配置或绕过，把情况告诉用户，问他是否要放开。

## 写操作后要自查是否真生效

接口返回 `retcode:0` 只代表请求被接受，不代表真生效。做完改动用 `info` 复核，它读的是实时值（`no_cache`）：

```bash
qq.mjs info 测试群 张三      # → 张三(12345) ← 测试群(987654)：member，禁言剩余 87s
```

如果 `info` 显示没变，把情况告诉用户，不要反复重试。

## 权限前提

踢人/禁言要求机器人账号在该群是**管理员或群主**。如果返回 retcode 非 0，多半是这个原因，别重试，把原始报错给用户。

## 自测

不需要真 QQ 账号，用内置的模拟 OneBot 服务跑全部逻辑（含歧义、群主保护、参数换算）：

```bash
node ~/.zcode/skills/qq-group/test/test.mjs    # 期望 30 通过 0 失败
```
