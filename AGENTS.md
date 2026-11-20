# Kiro Provider

- 目标：DSH Host 直接请求 Kiro。默认浏览器 OAuth；API Key、手动短期会话和官方 CLI 为可选方式。Magpie 是协议参考，旧 `dsh-kiro` 不作为依赖。
- `src/index.mjs` 管 Cordis 生命周期与模型路由；`src/controller.mjs` 管连接、模型与设置调用；`src/cli.mjs` 是官方二进制与隔离工作目录的唯一入口；`src/acp.mjs`/`src/adapter.mjs` 管传输和 DSH 流协议。
- 浏览器只调用 `kiroProvider` 类型化 RPC，设置使用 Config Editor，API Key 由 DSH credentials 解析。分离模型、认证、调用快照；不读取 IDE、CLI 或 Magpie 的私有令牌文件，不改第三方客户端标识。
- 使用独立的 `kiro-native` 模型路由；允许与旧 `kiro` 路由并存。测试只用临时目录、假凭据和模拟二进制，执行 `npm run check` 后打包。
- `src/direct-http.mjs` 负责直连认证、主机和目录契约，`src/direct-wire.mjs` 负责会话、工具别名与历史投影，`src/direct-stream.mjs` 负责 AWS EventStream，`src/direct.mjs` 将这条路径注入宿主 `PiAiAdapter`，不启用额外服务器。凭据由 DSH 引用解析，不进入设置响应或 SDK 占位参数。
- `src/oauth.mjs` 持有登录任务和临时回环回调，`src/oauth-wire.mjs` 负责 PKCE 与 Kiro/AWS 交换，`src/oauth-grant.mjs` 通过 DSH 凭据服务保存和续期独立授权。仅登录开始返回授权链接；轮询不返回授权码、令牌或 verifier。验收结果和协议参考见 [设计说明](docs/design.md)。
