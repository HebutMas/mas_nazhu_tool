# 第三方组件声明 / Third-Party Notices

本仓库包含以下第三方组件。它们各自适用自己的许可证，**独立于本仓库**。使用时请遵守其条款。

---

## NapCatQQ

| 项目 | 内容 |
|---|---|
| 名称 | NapCatQQ |
| 来源 | https://github.com/NapNeko/NapCatQQ |
| 版权 | Copyright © 2024 Mlikiowa |
| 版本 | v4.18.28 |
| 文件 | `NapCat.Shell.zip`（29,498,670 字节） |
| SHA256 | `bcdd8bdb9e44bd0cf6a90908e572141787fd9e98cb8d8eecc5adf25bbdcabb94` |
| 许可证 | Limited Redistribution License for NapCat（完整原文见 `LICENSE-NapCat.txt`） |
| 用途 | QQ 协议端：Hook 注入真实 QQ 客户端，把其能力以 OneBot 11 接口暴露出来 |

`NapCat.Shell.zip` 是官方 release 的**原始文件，未做任何修改**。上面的 SHA256 可用于核对：下载后自行计算哈希，与不一致即表示文件被改动过。

### 为什么本目录要有这些文件

NapCat 使用的**不是** MIT / Apache 这类宽松协议，而是作者自制的 *Limited Redistribution License*。它明确要求：

> **Redistribution of this code is permitted, provided that the full text of this license is included, and the source and copyright information is clearly stated.**

即：**再分发必须附带完整许可证原文，并清楚标注来源与版权**。因此本目录同时提供三样东西：

1. `NapCat.Shell.zip` —— 官方发布包本体
2. `LICENSE-NapCat.txt` —— 许可证完整原文
3. 本文件 —— 来源、版权、版本、哈希

> 注意：NapCat 官方发布包内**并没有**附带自己的 LICENSE 文件，所以这份许可证文本是由本仓库补上的。缺少它将构成违规分发。

### 许可证要点

以下仅为方便阅读的摘要，**以 `LICENSE-NapCat.txt` 原文为准**：

1. **再分发允许**，条件是附带完整许可证原文并标注来源与版权。
2. **仅限非商业用途**（"This code is not to be used for any commercial purposes"）。本仓库及其预期使用场景均为非商业性质。**如你打算用于商业用途，必须自行向 NapCat 作者取得授权。**
3. 未经作者明确许可，不得使用、复制、修改或分发其代码。
4. 为再分发所做的少量修改与扩展是允许的，但修改后的代码不得公开发布。
5. 软件按"原样"提供，作者不承担任何担保与责任。

### 与本仓库的关系

- 本仓库作者与 NapCat 作者无任何隶属或合作关系。
- 本仓库**未修改** NapCat 的任何文件，仅原样附带其官方发布包，方便使用者一次性获取。
- NapCat 的行为及其后果由使用者自行承担，本仓库作者不对此负责。

---

## 依赖的第三方库

本仓库自身代码使用的第三方库：

| 组件 | 许可证 | 用途 |
|---|---|---|
| [openpyxl](https://openpyxl.readthedocs.io/) | MIT | `export/export_names.py` 写 xlsx |
| Node.js 内置模块 | — | `skill/qq.mjs` 零外部依赖，仅用官方运行时 |

NapCat 自身 `node_modules/` 内还包含 express、ws 等库，其许可证随包内各自目录附带。
