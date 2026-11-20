# Kiro Provider 设计

采用 `dsh-devin-provider` / `dsh-volcengine-provider` 的 Host、Typert RPC、Web Settings slot 和可打包 Bundle 分离。新路由 `kiro-native` 独立于旧插件；现有聊天配置不会隐式切换。模型目录按连接模式缓存五分钟，凭据变更、连接切换或手动刷新使缓存失效。DSH 模型设置与 Key 引用保存在插件配置中，OAuth 存储归 Kiro CLI。

直连模式只与 Kiro 的管理面和运行时 HTTPS 域名通信，禁止重定向。`direct-http` 负责认证、模型目录和推理请求；`direct-wire` 构建会话历史并映射工具名，`direct-stream` 校验 AWS EventStream 的帧与 CRC 并转换增量事件。通过 `direct` 中的进程内 `fetch` 注入复用 DSH PiAiAdapter 现有的消息、图片投影与工具回放。没有本地网关和 Kiro CLI 依赖，DSH 保有工具调用审批和执行权。旧工具可能为了回放历史出现在上游声明中，但只有本轮工具可由模型调用。上游没有返回的 token 用量不作估算。

ACP 是代理会话接口，不是无状态模型 API；CLI 路径只转发文本、思考与终止状态，避免把 Kiro 执行的工具误当作由 DSH 执行的工具。插件不向 ACP 发送 DSH 工具声明，并拒绝 ACP 发起的权限请求。

## 接入契约

- 浏览器登录的任务状态和轮询沿用 Volcengine Provider 的模式；授权记录使用 Devin Provider 采用的 DSH `CredentialProvider.modifyRecord`，借助存储锁串行化令牌续期。与 kxyAI/Codex 一样，OAuth 客户端、临时回调和凭据独立于官方 CLI 的数据。`oauth` 管理回环监听和状态，`oauth-wire` 管理 PKCE、AWS 注册、Kiro 授权交换和续期，`oauth-grant` 管理专属凭据记录。登录页的回环回调不承载推理流量。
- [客户端接口参考](https://github.com/magpie-community/plugins/blob/e38f4f39fe92b1fe14bad14ad38e8b557fa61d44/packages/kiro/index.mjs)：API Key 与会话分别使用对应的模型目录接口，推理使用 `GenerateAssistantResponse`。Magpie 只提供公开源码参考；插件不导入其代码、配置或令牌文件。客户端标识使用 DSH 插件自身的名称和版本。
- [AWS 公共客户端注册](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_RegisterClient.html)；[Kiro 登录方式](https://kiro.dev/docs/getting-started/authentication/)。Kiro 登录页兼容 Kiro 的回环参数和回调格式；登录授权码与 PKCE verifier 只保存在待完成登录的 Host 内存中。
- [CLI 命令](https://kiro.dev/docs/reference/cli-commands/): `chat --list-models --format json`、`login`、`acp --agent-engine=v3 --auth-method=cli`。
- [ACP V3](https://kiro.dev/docs/cli/v3/acp-migration/): 模式、模型和档位的运行时确认；按会话 ID 隔离流，忽略重放分片；以 `session/prompt` 的响应终止。
- [Kiro 配置](https://kiro.dev/docs/configuration/): 独立连接使用独立 `KIRO_HOME`。自定义 Agent 和 permissions 禁用其工具；本地复用检查有无会自动加载的文件配置。此目录是 CLI 配置边界，进程仍在宿主权限下运行。
- [认证和无交互模式](https://kiro.dev/docs/getting-started/authentication/): 浏览器登录优先于同时存在的 Key；因此 Key 模式使用独立目录。Key 只进入官方子进程环境，不进入启动参数、请求转录、设置响应或日志。

## 验收

离线测试使用模拟 CLI/ACP 和 Kiro HTTP/AWS 二进制响应，覆盖请求主机限制、凭据边界、模型发现、帧校验、MCP 工具别名及结果回放、连接缓存、CLI 权限拒绝、取消和 DSH 生命周期。CLI 核验了官方 3.5.0 的 ACP 握手和未登录行为；图片和桌面设置页尚未端到端验证。

Alpha 3 的隔离 DSH Host 使用现有的短期会话凭据做真实测试：管理面返回 23 个模型，运行时返回 Claude Sonnet 5.5 的流式文本。两轮工具测试确认发送时使用合法别名，DSH 收到原工具名及参数，回传同一调用 ID 的合成结果后模型返回预期文本。测试期间网络只访问 Kiro 两个 HTTPS 域名，未修改凭据或桌面 Profile。API Key 路径尚未使用真实 Key 测试。
