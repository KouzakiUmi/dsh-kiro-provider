# Kiro Provider

- 目标：DSH Host 直接请求 Kiro。默认浏览器 OAuth；API Key、手动短期会话和官方 CLI 为可选方式。Magpie 是协议参考，旧 `dsh-kiro` 不作为依赖。
- 使用独立的 `kiro-native` 模型路由；允许与旧 `kiro` 路由并存。测试只用临时目录、假凭据和模拟二进制，执行 `npm run check`（构建 + 产物语法自检 + 测试）后打包。

## 目录拓扑与依赖方向

Host（Node ESM，`src/*.mjs`，构建原样复制到 `lib/`）：

```
index.mjs（组合根：Config + apply + 生命周期）
├── llm-adapter.mjs（LlmAdapter：listModels/prepareCall/stream，直连与 ACP 分派）
├── service.mjs（kiroProvider RPC：op 白名单分派）
├── controller.mjs（连接编排：snapshot/target/凭据解析/status 视图）
│   ├── catalog.mjs + usage.mjs（两类资源：解析、校验、TTL 配置）
│   │   └── resource.mjs（拉取/读取分离中间件：read/refresh/revalidate/reset）
│   │       └── store.mjs（持久化中间件：原子写、锁、指纹键、失效）
│   ├── usage-scheduler.mjs（额度定时补采：6 次失败暂停，手动刷新恢复）
│   └── 传输层：cli.mjs / direct-http.mjs / direct-wire.mjs / direct-stream.mjs / direct.mjs / acp.mjs / adapter.mjs
├── browser-open.mjs（登录自动开窗：URL 白名单 + 平台 opener，无 shell）
└── oauth.mjs / oauth-wire.mjs / oauth-grant.mjs（登录任务、PKCE 交换、凭据记录）
```

Client（浏览器 React，`src/client/*.js`）：`styles → kit → store → login/connection/models/usage/advanced → pill → settings → index`。构建按 `scripts/build.mjs` 的依赖序表拼接进单一 `window.__ModuleLoader__.load` 工厂作用域；**模块不写 import**，跨模块用裸标识符，新模块必须登记进顺序表。`remote.mjs` 是 host/client 共享契约（含 ADVANCED_BOUNDS 边界真源），拼接在首位。

依赖单向：组合根 → 编排 → 中间件 → 传输；client 只经 `kiroProvider` RPC 消费 host 投影，不 import 宿主包。`model-name.mjs` 是 host/client 共享显示投影（可读名/倍率徽标/旧版判定），拼接在 remote.mjs 之后。

## 职责唯一落位表

| 职责 | 唯一落位 |
|---|---|
| 插件配置（mode/region/cliPath/keyRef/disabledModels/modelDefaults/statePath） | Config Editor + `index.mjs` Config，volatile 原地更新 |
| 派生快照持久化（目录/额度，零凭据） | `store.mjs` → `<statePath 或 storages/dsh-kiro-provider>/state.json` |
| 拉取/读取分离、TTL、退避、SWR | `resource.mjs`（catalog 5min / usage 60s） |
| 额度定时补采与暂停 | `usage-scheduler.mjs`（间隔 quotaRefreshSeconds，6 次失败暂停） |
| 登录自动开窗 | `browser-open.mjs`（白名单校验，autoOpenBrowser 开关） |
| 高级设置边界 | `remote.mjs` ADVANCED_BOUNDS（host 归一化与 client 校验共用） |
| 模型目录解析与校验 | `catalog.mjs`（CLI JSON）+ `direct-http.mjs`（直连分页） |
| 显示名/倍率徽标/旧版判定 | `model-name.mjs`（共享纯函数；请求 ID 原样保留，倍率只走徽标不进名称；选择器徽标走核心 LlmModelInfo.badge，仅 listModels 广告） |
| 模型三态启停 | `disabledModels`（显式关）> `enabledModels`（显式开）> 推荐默认（旧版关）；`recommend` op 清除手动开关 |
| 额度解析与校验 | `usage.mjs`（GetUsageLimits / Get-Usage-Limits 投影） |
| 凭据 | DSH credentials：API Key/会话按引用解析；OAuth 归 `oauth-grant.mjs` 记录 |
| RPC 契约（op 与响应校验） | `remote.mjs`（双端共用） |
| UI 形状原语 | `client/kit.js`；样式令牌唯一来源 `client/styles.js`（`--kiro-*` → `--dsw-alias-*`） |
| Client 状态 | `client/store.js`（快照 + 分域 busy + 序号票 + 写操作乐观投影/失败回滚） |
| 设置页布局 | `client/settings.js` 四 tab（概览/模型/连接与登录/高级）+ 键盘导航 |
| 额度视图投影 | `client/usage.js` quotaStatusView 纯函数（error>需登录>stale>空>最差窗口） |
| 会话输入栏药丸 | `client/pill.js`：上下文档位药丸（256K/500K/1M 快捷档+默认，按模型持久化 contextTier，原生窗口封顶；注入 ModelDirectory 本体读会话选择，写入走 modelContext 字段级合并 op）+ 额度药丸（30s 静默 `status` 轮询、迷你条与弹窗详情、手动 `usage` 刷新，仅 kiro-native 会话渲染） |
| token 用量上报与窗口学习 | `adapter.mjs` 解析 ACP `usage_update` / `_kiro.dev/metadata` / `PromptResponse.usage`，在 `usage_update.size` 时学习窗口；`llm-adapter.mjs` 以 observedWindows 覆盖目录缺失容量；`direct-stream.mjs` 用 contextUsagePercentage / totalTokens 补全计数 |

## 技术范式锁

- 持久化只用 `store.mjs`：lock(wx) + tmp(0o600) + rename 原子写，锁内重读合并，version=1 文档，加载/写入双向校验，损坏即弃。
- 读路径（`read`/`status`/`listModels`）永不等待上游：内存 → 磁盘 → 空；陈旧由 `revalidate` 后台补采，失败指数退避且保留上次成功快照。写操作只失效缓存，不直接拉取。
- 设置保存走 Config Editor；凭据走 DSH credentials；状态文件只存派生快照与引用名。
- UI 走 `client/styles.js` 的 `--kiro-*` 令牌（映射 `--dsw-alias-*` 宿主令牌，缺失时 `currentColor` 混色回退）+ `.kiro-*` scoped 样式（760px、12px 卡片圆角、亮/暗 color-scheme）；状态色只经 `data-tone` 映射，JS 不硬编码色值；列表条目一律 kit Row；面板消费快照与动作，RPC 只经 store；写操作乐观投影、失败回滚原值并统一通知。
- 错误只输出本插件撰写的有界文案（`safeProblem`），不回显上游原文、路径或凭据。

## 反模式禁令

- 不新建第二套缓存/持久化/HTTP 客户端；不在 resource 之外私设 TTL 缓存。
- 不能把凭据、授权码、verifier、上游原始错误写入状态文件、设置响应或日志。
- 读操作不得触发阻塞式上游拉取；登录轮询不得返回令牌类字段。
- client 模块不写 import、不 require 宿主 Client 包；样式不写魔法色值。
- 不读取 IDE、CLI 或 Magpie 的私有令牌文件，不改第三方客户端标识。

## 交接快照

- 已完成：host 模块化拆分、持久化中间件、目录/额度拉取读取分离、modelDefaults（effort/maxTokens/contextTier）、creditRate、RPC 扩展（usage/modelSettings/modelContext/advanced/recommend）、client kit 化 UI、上下文窗口调整药丸（kxyai 档位语义）、额度药丸（迷你条 + 弹窗 + 手动刷新）、ACP/直连 token 用量上报与上下文窗口学习、目录容量字段别名（contextWindow/maxTokens）、78 项离线测试（含中间件/额度/契约/client store/药丸接线/组件渲染冒烟/调度器/开窗白名单/显示投影/三态启停/service 写路径/选择器 badge/上下文档位/直连覆写/ACP usage/直连用量换算）。opendesign 对齐（A–H+I）与 Unified Router 对齐（可读显示名、x倍率徽标+消耗色调、旧版默认关闭+恢复推荐、选择器原生 badge）均已落地；旧版判定经 AA 直连数据核实（docs/model-curation.md，23 模型中 18 旧版）。独立交叉核验发现的 pill 写路径缺陷、Switch props 笔误与药丸陈旧默认覆盖竞态均已修复并加回归测试。
- 未端到端验证：桌面设置页亮/暗色与窄屏渲染、pill 运行时行为、真实账号额度接口（协议取自 Magpie 公开参考，离线测试用模拟响应）。验证入口：安装 bundle 后打开设置 → Kiro Provider；pill 需会话选中 kiro-native 模型。
- 协议参考与设计取舍见 [设计说明](docs/design.md)；公开仓库 github.com/KouzakiUmi/dsh-kiro-provider。