# NapCat 安装与登录

本工具依赖 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 作为 QQ 协议端。NapCat 通过 Hook 注入**真实的 QQ 客户端**，把 QQ 的内部能力以 [OneBot 11](https://github.com/botuniverse/onebot-11) 标准 HTTP 接口暴露出来，我们的脚本再调这个接口。

> **风险提示（请先读完再动手）**
> 这是第三方协议实现，不是腾讯官方方案。用它跑 QQ 号**存在被冻结或封号的风险**，且本项目不承担任何责任。务必用小号，不要用主号。详见 README 的「风险与合规」。

---

## 一、前置条件

| 项目 | 要求 | 说明 |
|---|---|---|
| 操作系统 | Windows 10 / 11 x64 | 本文只覆盖 Windows |
| QQ | QQNT 版本，**构建号 ≥ 40768** | 旧版 QQ（非 NT 架构）不支持 |
| NapCat | v4.18.x | 下载见下 |
| 权限 | **不需要管理员权限** | 网上不少教程要求提权，实测没必要 |

检查 QQ 版本：NapCat 启动日志里会打印 `config_current_version`，形如 `9.9.33-52230`，横杠后面的 **52230** 就是构建号，需要 ≥ 40768。

## 二、安装

1. **直接用本仓库附带的官方包**：`third_party/napcat/NapCat.Shell.zip`（v4.18.28，约 28 MB）。

   > 想自己下也行：[NapCatQQ Releases](https://github.com/NapNeko/NapCatQQ/releases/latest)。同页面还有 `NapCat.Shell.Windows.OneKey.zip`（一键版，内置 QQ，不必管本机 QQ 版本），但它正文包 100 MB+，`NapCat.Shell.zip` 更轻。
   >
   > 无论从哪来，**请先读 `third_party/napcat/NOTICE.md`**：NapCat 不是宽松许可，再分发有强制条件，且仅限非商业用途。

2. 解压到一个固定目录，例如 `D:\NapCat`。解压后应能看到：

   ```
   NapCatWinBootMain.exe      ← 启动器
   NapCatWinBootHook.dll      ← 注入用的 Hook
   qqnt.json                  ← 内存补丁（改 QQ 的 package.json 入口）
   launcher.bat               ← 官方启动脚本
   napcat.mjs                 ← NapCat 本体（3 MB）
   config/napcat.json
   ```

   **NapCat 不会改动你磁盘上的 QQ 安装**——它是靠 `NapCatWinBootHook.dll` 拦截 QQ 读取 `package.json` 时替换成 `qqnt.json` 的内容实现的。所以卸载只需删掉这个目录。

3. 编辑 `config/napcat.json`，把文件日志打开（便于排查问题）：

   ```json
   { "fileLog": true, "fileLogLevel": "info" }
   ```

4. 编辑 `config/webui.json`，把 WebUI 从"监听所有网卡"改成只监听本机：

   ```json
   { "host": "127.0.0.1", "port": 6099 }
   ```

   > **这一步别跳过。** NapCat 默认 `host` 是 `::`（所有网卡），意味着同一局域网内的其他设备也能访问你的 WebUI。改成本机后只有这台机器能连。

## 三、启动与登录

用仓库里的 `setup/start-napcat.bat`（已经处理好下面这些坑），先改脚本顶部三行：

```bat
set "QQ_NUMBER=你的QQ号"
set "NAPCAT_DIR=D:\NapCat"
set "QQ_EXE=D:\qq\QQ.exe"
```

然后双击运行。它会：先杀掉可能残留的 QQ → 设置 NapCat 需要的环境变量 → 用独立窗口拉起 NapCat。

**首次启动需要扫码登录**：手机 QQ 扫控制台里打印的二维码，或者打开 WebUI（地址和 token 会打印在启动日志里，形如 `http://127.0.0.1:6099/webui?token=xxxxxx`）。

**登录过一次之后，后续启动就不用再扫码了**——脚本顶部设的 `NAPCAT_QUICK_ACCOUNT` 就是干这个的（等价于命令行 `-q <QQ号>`）。

### 三个容易踩的坑

**1. 双击启动脚本没反应。** 两个原因：
   - 脚本文件必须是 **CRLF 换行**。用编辑器另存时选 "Windows (CRLF)"，LF 换行会让 cmd 解析出错。
   - 文件**不能带 UTF-8 BOM**。BOM 会让第一行 `@echo off` 报错。

**2. 启动后 NapCat 立刻退出。** 多半是本机已经有 QQ 在运行（单实例冲突）：NapCat 拉起的新实例会被旧实例挤掉，随即一起退出。先手动退出 QQ，或让脚本开头的 `taskkill` 生效。

**3. 提示缺运行库 / xxx.dll。** 装一下 [VC++ 运行库](https://aka.ms/vs/17/release/vc_redist.x64.exe)。

## 四、开启 OneBot HTTP 服务

NapCat 登录成功后，编辑它的 OneBot 配置文件 `config/onebot11_<你的QQ号>.json`，在 `httpServers` 里加一项：

```json
{
  "network": {
    "httpServers": [
      {
        "name": "http-local",
        "enable": true,
        "port": 3000,
        "host": "127.0.0.1",
        "enableCors": false,
        "enableWebsocket": false,
        "messagePostFormat": "array",
        "token": "换成一个你自己的随机字符串",
        "debug": false
      }
    ]
  }
}
```

要点：

- `host` 填 `127.0.0.1`，**不要填 `0.0.0.0`**，否则接口会暴露到局域网。
- `token` 必须设，不设等于谁都能调你的接口来发消息、踢人。
- 改完要**重启 NapCat** 才生效。

## 五、验证

```bash
curl -X POST http://127.0.0.1:3000/get_login_info \
  -H "Authorization: Bearer 你的token" \
  -H "Content-Type: application/json" -d '{}'
```

返回 `{"status":"ok","retcode":0,"data":{"user_id":...,"nickname":"..."}}` 就通了。

接着把 skill 的配置文件建好（见 README「安装到 AI 客户端」），然后跑：

```bash
node ~/.zcode/skills/qq-group/qq.mjs doctor
```

看到 `✔ NapCat http://127.0.0.1:3000 已连接，账号 xxx，online=true` 就成了。

## 六、常见问题

**接口返回 retcode 非 0。** 最常见是**权限不够**——踢人、禁言要求机器人账号在目标群是**管理员或群主**。先去群里把机器人设成管理员。

**`shut_up_timestamp` 读出来是 0，但禁言看着成功了。** 字段名是 `shut_up_timestamp`（不是 `shutup_time`），而且要用 `no_cache: true` 才读到实时值。

**接口返回的 `sex` 都是 `unknown`、`qq_level` 都是 `0`。** 这是 NapCat 这个接口本身就不填这些字段，不是调用方的问题。做统计时不要依赖这两列。
