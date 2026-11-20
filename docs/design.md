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
- **每模型默认设置**：`modelDefaults` 存于插件配置（id + effort + maxTokens），调用时只填充未显式指定的参数；effort 须在该模型公布档位内，maxTokens 须在 `maxTokenRange` 内，保存时按目录校验。CLI 路由不支持输出上限，默认 maxTokens 不生效。
- **上下文 pill**：`conversation.input.right` slot，注入 `ctx.modelDirectories.directoryFor(sessionId)` 的 ModelDirectory 本体：订阅其 `store` 快照读取会话选择，档位写入走实例的 `select`（官方 `session.selectModel`）。仅当前 provider 为 `kiro-native` 时渲染上下文窗口与档位快捷按钮。服务契约按目标 Core 0.2.2-rc.5 的 `dsh-client-ui-model-selection` 源码核实（`select` 在实例上，快照 store 只有 subscribe/getSnapshot）。

## 客户端结构

`src/client/` 按依赖序拼接：styles（`--kiro-*` 令牌映射 `--dsw-alias-*`，暗色回退、容器查询、reduced-motion）→ kit（Section/Row/Switch/Notice/Chip/Meter/EmptyState，唯一拼元素形状的层）→ store（快照唯一真源、分域单飞 busy、序号票丢弃过期响应、登录轮询退避、可见性门控 30s 静默读）→ 面板（login/connection/models/usage，草稿本地、任务状态来自快照）→ pill → settings 根组件 → index 入口。构建做 export 形状校验与 `vm.Script` 语法自检；`npm run check` 含 `node --check lib/client.js`。

## 接入契约

- 浏览器登录的任务状态和轮询沿用 Volcengine Provider 的模式；授权记录使用 Devin Provider 采用的 DSH `CredentialProvider.modifyRecord`，借助存储锁串行化令牌续期。与 kxyAI/Codex 一样，OAuth 客户端、临时回调和凭据独立于官方 CLI 的数据。`oauth` 管理回环监听和状态，`oauth-wire` 管理 PKCE、AWS 注册、Kiro 授权交换和续期，`oauth-grant` 管理专属凭据记录。登录页的回环回调不承载推理流量。
- [客户端接口参考](https://github.com/magpie-community/plugins/blob/e38f4f39fe92b1fe14bad14ad38e8b557fa61d44/packages/kiro/index.mjs)：API Key 与会话分别使用对应的模型目录接口，推理使用 `GenerateAssistantResponse`。Magpie 只提供公开源码参考；插件不导入其代码、配置或令牌文件。客户端标识使用 DSH 插件自身的名称和版本。
- [AWS 公共客户端注册](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_RegisterClient.html)；[Kiro 登录方式](https://kiro.dev/docs/getting-started/authentication/)。Kiro 登录页兼容 Kiro 的回环参数和回调格式；登录授权码与 PKCE verifier 只保存在待完成登录的 Host 内存中。
- [CLI 命令](https://kiro.dev/docs/reference/cli-commands/): `chat --list-models --format json`、`login`、`acp --agent-engine=v3 --auth-method=cli`。
- [ACP V3](https://kiro.dev/docs/cli/v3/acp-migration/): 模式、模型和档位的运行时确认；按会话 ID 隔离流，忽略重放分片；以 `session/prompt` 的响应终止。
- [Kiro 配置](https://kiro.dev/docs/configuration/): 独立连接使用独立 `KIRO_HOME`。自定义 Agent 和 permissions 禁用其工具；本地复用检查有无会自动加载的文件配置。此目录是 CLI 配置边界，进程仍在宿主权限下运行。
- [认证和无交互模式](https://kiro.dev/docs/getting-started/authentication/): 浏览器登录优先于同时存在的 Key；因此 Key 模式使用独立目录。Key 只进入官方子进程环境，不进入启动参数、请求转录、设置响应或日志。

## 验收

离线测试 48 项：模拟 CLI/ACP 和 Kiro HTTP/AWS 二进制响应，覆盖请求主机限制、凭据边界、模型发现、帧校验、MCP 工具别名及结果回放、CLI 权限拒绝、取消和 DSH 生命周期；新增持久化原子写/锁竞合/损坏容忍/跨实例合并、拉取读取分离/去重/退避/代际失效、额度投影与校验、RPC 新 op 契约、client store 单飞与过期响应丢弃。测试状态文件一律临时目录隔离。

Alpha 3 的隔离 DSH Host 使用现有的短期会话凭据做真实测试：管理面返回 23 个模型，运行时返回 Claude Sonnet 5.5 的流式文本。两轮工具测试确认发送时使用合法别名，DSH 收到原工具名及参数，回传同一调用 ID 的合成结果后模型返回预期文本。测试期间网络只访问 Kiro 两个 HTTPS 域名，未修改凭据或桌面 Profile。API Key 路径尚未使用真实 Key 测试。

本版本尚未端到端验证：桌面设置页亮/暗色与窄屏渲染、pill 运行时行为、真实账号额度响应。