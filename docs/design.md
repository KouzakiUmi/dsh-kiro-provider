# Kiro Provider 设计

采用 `dsh-devin-provider` / `dsh-volcengine-provider` 的 Host、Typert RPC、Web Settings slot 和可打包 Bundle 分离，客户端模块化纪律参考 `dsh-unified-router`。新路由 `kiro-native` 独立于旧插件；现有聊天配置不会隐式切换。DSH 模型设置与 Key 引用保存在插件配置中，OAuth 存储归 DSH 凭据服务。

## 分层与持久化中间件

Host 拆为组合根（`index`）、LLM 适配器（`llm-adapter`）、RPC 分派（`service`）、连接编排（`controller`）与传输层。目录与额度是两类派生资源，共用两层中间件：

- `store.mjs`（持久化）：`state.json` 只存派生快照，按 `catalog:<连接指纹>` / `usage:<连接指纹>` 键控。写入经 lock(wx) + tmp(0o600) + rename 原子落盘，锁内重读磁盘合并其他实例的写入；文档 version=1，加载与写入都按资源校验器过滤字段，损坏即弃、绝不覆盖原文件为无效内容。`invalidate` 同步清除内存条目、异步落盘删除，保证失效后的读立即看不到旧值。
- `resource.mjs`（拉取/读取分离）：`read` 只服务内存→磁盘，永不触发上游；`refresh` 是唯一拉取路径（显式刷新或后台补采），同键无信号调用去重；失败按 TTL 指数退避（上限 8 倍），保留上次成功快照并附错误文案；`revalidate` 在读到陈旧数据时后台补采不阻塞；`reset` 以代际号作废在途写入。目录 TTL 5 分钟，额度 TTL 60 秒。

读路径：设置 `status`、LLM `listModels` 都从存储返回，Host 重启后模型目录立即可用；陈旧时后台补采，成功后经 `llm/adapters-updated` 通知选择器。写路径（登录、切换连接、凭据变更）只失效缓存，由读路径懒补采或 UI 显式刷新。凭据变更与连接切换会同时失效对应指纹的磁盘快照。

## 直连与 CLI

直连模式只与 Kiro 的管理面和运行时 HTTPS 域名通信，禁止重定向。`direct-http` 负责认证、模型目录、额度与推理请求；`direct-wire` 构建会话历史并映射工具名，`direct-stream` 校验 AWS EventStream 的帧与 CRC 并转换增量事件。通过 `direct` 中的进程内 `fetch` 注入复用 DSH PiAiAdapter 现有的消息、图片投影与工具回放。没有本地网关和 Kiro CLI 依赖，DSH 保有工具调用审批和执行权。旧工具可能为了回放历史出现在上游声明中，但只有本轮工具可由模型调用。上游没有返回的 token 用量不作估算。

ACP 是代理会话接口，不是无状态模型 API；CLI 路径只转发文本、思考与终止状态，避免把 Kiro 执行的工具误当作由 DSH 执行的工具。插件不向 ACP 发送 DSH 工具声明，并拒绝 ACP 发起的权限请求。

## 功能契约

- **额度面板**：API Key 走管理面 `AmazonCodeWhispererService.GetUsageLimits`（AWS JSON 1.0），会话/OAuth 走 `Get-Usage-Limits?resourceType=CREDIT`。投影套餐名、月度 credits、超额上限（启用 overage 时套餐窗口仅展示、超额窗口才是停止线）、ACTIVE 赠送额度与免费试用；数字只取响应值，缺失不估算。CLI 三种模式无此接口，面板给出账户页入口。协议字段取自 Magpie 公开源码参考，真实账号响应尚未端到端验证。
- **credit 倍率**：目录行 `rateMultiplier`（`rateUnit=credit`）仅展示，表示请求消耗的倍率；实际消耗以流内 meteringEvent 为准（本版本不统计每请求消耗）。
- **每模型默认设置**：`modelDefaults` 存于插件配置（id + effort + maxTokens + contextTier），调用时 effort/maxTokens 只填充未显式指定的参数；effort 须在该模型公布档位内，maxTokens 须在 `maxTokenRange` 内，保存时按目录校验；contextTier 为上下文档位（见药丸条目）。CLI 路由不支持输出上限，默认 maxTokens 不生效。
- **上下文窗口调整药丸**（参考 kxyai `modelContextTiers` 语义）：`conversation.input.right` slot，注入 `ctx.modelDirectories.directoryFor(sessionId)` 的 ModelDirectory 本体，订阅其 `store` 快照读取会话选择；仅当前 provider 为 `kiro-native` 时渲染。快捷档 `standard/extended/maximum` = 256K/500K/1M（`CONTEXT_TIERS`，真源在共享契约 `remote.mjs`），以模型原生窗口封顶（`effectiveContextWindow = min(native, tier)`），等于/超过原生的档位与「默认」同值不重复展示。档位按模型持久化在 `modelDefaults.contextTier`，药丸经 **`modelContext` 字段级合并 op** 只写 contextTier（service 端保留配置中已有的 effort/maxTokens，杜绝药丸陈旧快照覆盖新设置）；设置页编辑器经 `modelSettings` 整行写。写入后 `llm/adapters-updated` 通知选择器目录刷新但不失效持久化快照。覆写只作用于广告给 DSH 的上下文预算（`modelInfo.context` 与直连 `directProfile` 的 contextWindow，影响压缩/计量），不改变上游请求参数。错误态提供原地重试。思考档位不再由药丸切换（会话档位走核心模型座 effort 菜单，默认档位在模型设置）。

## 客户端结构

`src/client/` 按依赖序拼接：styles（`--kiro-*` 令牌映射 `--dsw-alias-*`，860px 布局、12px 卡片圆角、`color-scheme` 暗色、容器查询、reduced-motion）→ kit（Section/Row/Switch/Notice/Chip/Meter/EmptyState/RelativeDeadline/NumberField，唯一拼元素形状的层）→ store（快照唯一真源、分域单飞 busy、序号票丢弃过期响应、写操作乐观投影与失败回滚、登录轮询退避、可见性门控 30s 静默读）→ 面板（login/connection/models/usage/advanced，草稿本地、任务状态来自快照）→ pill → settings 根组件 → index 入口。构建做 export 形状校验与 `vm.Script` 语法自检；`npm run check` 含 `node --check lib/client.js`。

设置页为四 tab（概览/模型/连接与登录/高级），tab 条支持方向键/Home/End 与 roving tabindex。概览含连接状态 chips 与额度面板；模型面板含名称+ID 搜索、`已启用 n/m` 计数、默认 6 条折叠展开、启用优先排序；高级面板暴露额度刷新间隔、流空闲超时、请求图片上限与登录自动开窗开关，边界真源为 `remote.mjs` 的 `ADVANCED_BOUNDS`（host 归一化与 client 校验共用）。

## 模型显示投影（Unified Router 对齐）

`model-name.mjs` 为 host/client 共享纯函数，参考 `dsh-unified-router` 的 DESIGN-STANDARDS §3 与 `lib/model-catalog.js` 模式（自实现，不导入其代码）：

- **可读显示名**：`readableModelName(id, name)` 清理 ID 格式——品牌词表（Claude/GPT/Grok/Kimi/MiniMax/GLM/DeepSeek/Qwen…）、连字符分词、版本连字符转点（`4-5`→`4.5`）、粘连品牌拆分（`qwen3`→`Qwen 3`）。请求 ID 原样保留在模型行副行与 RPC 中；DSH 选择器（`modelInfo`）与设置页共用同一投影。
- **扣费倍率徽标**：`modelRateBadge(rate)` 输出 `x{倍率}`（两位小数）标签 + 消耗色调（≤0.5 success / ≤1.5 info / >1.5 warning），设置页模型行使用；`selectorRateBadge(rate)` 输出核心原生 `LlmModelInfo.badge`（`{text:{en,zh}, tone:'neutral'}`），由 `listModels` 广告给会话选择器（Core `buildModelCatalog` 读取、`dsh-client-ui-model-selection` 原生渲染：收起态名前、下拉行名后；`resolveModel` 与请求/会话事件不携带——rc.5 类型与渲染源码已核）。倍率只由徽标表达，不拼进名称；未知倍率不挂徽标。数据来自目录 `rateMultiplier`（`rateUnit=credit`），仅展示。
- **旧版默认关闭**：`legacyModelIds(rows)` 双层判定——已核实外部后继表（SUPERSEDED，2026-11-21 直接访问 Artificial Analysis 排行榜内嵌数据核对 `deprecated` 标志，Kimi 用官方平台文档；逐条证据见 [模型策展](model-curation.md)）+ 目录内「同家族存在更高版本」（家族=去掉尾版本段的 ID，版本连字符先转点；版本段允许单字母前缀如 `m2.5`/`k3`）。变体型号（`gpt-5.6-sol/terra/luna`）不互相压制，但 GPT-5.6 全系经 AA 确认已弃用。真实目录 23 模型中 18 个默认关闭，仅 Auto 与 Claude 5.5 三型、Grok 4.7 默认开启。启停为三态：`disabledModels`（显式关）> `enabledModels`（显式开）> 推荐默认；「恢复推荐」（`recommend` op）清除两数组回到推荐列表。Host 的 `status`/`listModels`/`prepareCall` 与 client 开关共用 `controller.modelEnabled` 语义（legacy 按 rows 引用缓存）。

## opendesign 对齐（行为模式）

参考 `dsh-opendesign-corouter` 0.3.4 的设计，取其行为模式而非文件布局：

- **额度严重度链**：`quotaStatusView` 纯函数，优先级 error > 需登录 > stale > 无窗口 > 最差窗口 percent（≥100 已用尽 / ≥91 即将用尽 / ≥71 偏高 / 其余正常）；aside 窗口（overage 开启时的套餐展示窗）不参与严重度，停止线是 overage 窗口。指标卡按窗口渲染，数字只取 Kiro 响应。
- **活倒计时**：`RelativeDeadline` 输出 `<time dateTime>`；额度面板对准最近的刷新/重置/到期时刻定时重渲染，隐藏页签暂停、可见时立即补一次。
- **额度自动刷新**：`usage-scheduler.mjs` 按 `quotaRefreshSeconds`（5–3600，默认 60）定时补采，连续 6 次失败暂停并在 UI 显示，手动刷新成功清零恢复；定时补采复用 resource 的退避，读路径仍不阻塞。
- **乐观写 + 回滚**：store 对 connection/model/modelSettings/advanced 写操作立即投影到视图，成功以 Host 视图替换并通知「设置已保存。」，失败回滚写前快照并通知「设置未保存，已恢复原值，请重试。」。
- **登录自动开窗**：本地发起的登录成功后经 `browser-open.mjs` 打开一次默认浏览器（Windows rundll32 / macOS open / Linux xdg-open，均无 shell），URL 白名单与 loginStart 响应校验同构；`autoOpenBrowser` 可关，失败静默、设置页链接仍可点击。不引入 playwright。
- **固定文案**：client 错误文案鸭子类型取 message（跨 realm 稳健），host 只出 `safeProblem` 有界文案。

不可移植项（协议/产品差异）：temperature/topP（Kiro 直连不支持）、上下文档位覆写与协议选择（Kiro 无此 API）、价格目录（Kiro 为 credit 制，倍率已展示）、模型权益分组（单账号目录）、turn monitor/EOT 恢复（网关专属）。

## 接入契约

- 浏览器登录的任务状态和轮询沿用 Volcengine Provider 的模式；授权记录使用 Devin Provider 采用的 DSH `CredentialProvider.modifyRecord`，借助存储锁串行化令牌续期。与 kxyAI/Codex 一样，OAuth 客户端、临时回调和凭据独立于官方 CLI 的数据。`oauth` 管理回环监听和状态，`oauth-wire` 管理 PKCE、AWS 注册、Kiro 授权交换和续期，`oauth-grant` 管理专属凭据记录。登录页的回环回调不承载推理流量。
- [客户端接口参考](https://github.com/magpie-community/plugins/blob/e38f4f39fe92b1fe14bad14ad38e8b557fa61d44/packages/kiro/index.mjs)：API Key 与会话分别使用对应的模型目录接口，推理使用 `GenerateAssistantResponse`。Magpie 只提供公开源码参考；插件不导入其代码、配置或令牌文件。客户端标识使用 DSH 插件自身的名称和版本。
- [AWS 公共客户端注册](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_RegisterClient.html)；[Kiro 登录方式](https://kiro.dev/docs/getting-started/authentication/)。Kiro 登录页兼容 Kiro 的回环参数和回调格式；登录授权码与 PKCE verifier 只保存在待完成登录的 Host 内存中。
- [CLI 命令](https://kiro.dev/docs/reference/cli-commands/): `chat --list-models --format json`、`login`、`acp --agent-engine=v3 --auth-method=cli`。
- [ACP V3](https://kiro.dev/docs/cli/v3/acp-migration/): 模式、模型和档位的运行时确认；按会话 ID 隔离流，忽略重放分片；以 `session/prompt` 的响应终止。
- [Kiro 配置](https://kiro.dev/docs/configuration/): 独立连接使用独立 `KIRO_HOME`。自定义 Agent 和 permissions 禁用其工具；本地复用检查有无会自动加载的文件配置。此目录是 CLI 配置边界，进程仍在宿主权限下运行。
- [认证和无交互模式](https://kiro.dev/docs/getting-started/authentication/): 浏览器登录优先于同时存在的 Key；因此 Key 模式使用独立目录。Key 只进入官方子进程环境，不进入启动参数、请求转录、设置响应或日志。

## 验收

离线测试 65 项：模拟 CLI/ACP 和 Kiro HTTP/AWS 二进制响应，覆盖请求主机限制、凭据边界、模型发现、帧校验、MCP 工具别名及结果回放、CLI 权限拒绝、取消和 DSH 生命周期；新增持久化原子写/锁竞合/损坏容忍/跨实例合并、拉取读取分离/去重/退避/代际失效、额度投影与校验、RPC 新 op 契约、client store 单飞/过期响应丢弃/乐观写回滚、pill 接线、调度器暂停与恢复、开窗白名单与平台 opener、显示名/倍率徽标/旧版判定（真实 Kiro 目录 fixture + AA 核实的外部后继表）、三态启停与恢复推荐、service 写路径（model/recommend/modelSettings 的编辑回调），以及展开函数组件的渲染冒烟测试（kit 原语与全部面板组件体，捕获 props 简写笔误类运行时错误）。测试状态文件一律临时目录隔离；登录测试关闭自动开窗，不产生真实浏览器副作用。

Alpha 3 的隔离 DSH Host 使用现有的短期会话凭据做真实测试：管理面返回 23 个模型，运行时返回 Claude Sonnet 5.5 的流式文本。两轮工具测试确认发送时使用合法别名，DSH 收到原工具名及参数，回传同一调用 ID 的合成结果后模型返回预期文本。测试期间网络只访问 Kiro 两个 HTTPS 域名，未修改凭据或桌面 Profile。API Key 路径尚未使用真实 Key 测试。

本版本尚未端到端验证：桌面设置页亮/暗色与窄屏渲染、pill 运行时行为、真实账号额度响应。