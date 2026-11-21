# Kiro Provider

在 DeepSeek Harness 的模型选择器中使用 Kiro。Alpha 版面向 DSH Core `0.2.2-rc.5` 和 Node `22.19+`，使用独立路由 `kiro-native`，可与旧 `kiro` 路由并存。直连模式由 DSH Host 请求 Kiro，不需要 Magpie、其他网关或 Kiro CLI。

## 登录和选模型

安装 Kiro Provider 后，打开 **设置 → Kiro Provider → 选择登录方式**：

- **IAM Identity Center（组织 Start URL）**：输入组织提供的 AWS Start URL 和 AWS 区域，在浏览器完成组织授权。
- **AWS Builder ID**：在 AWS 登录个人 Builder ID。
- **Kiro 登录页**：在 Kiro 官方页面选择 Google、GitHub、Builder ID 或 IAM Identity Center。使用自有外部身份提供商的组织可在官方 Kiro CLI 登录后复用其登录态。

点击生成的链接，在同一台机器的浏览器完成授权，再返回 DSH。插件保存自己的登录凭据，之后直接调用 Kiro 并按需续期。无需 Magpie 或 CLI。断开登录会删除本插件在 DSH 保存的授权。

**其他登录方式**：

| 连接方式 | 操作 | 对话 |
|---|---|---|
| Kiro API Key 直连 | 将 Kiro API Key 保存到 DSH 凭据，默认引用名 `KIRO_API_KEY`。在插件选择账号所在区域。 | 流式对话、DSH 工具调用、目录声明支持的图片 |
| Kiro 会话凭据直连 | 在 DSH 凭据中保存已取得的 Kiro 会话，默认引用名 `KIRO_SESSION`。区域从账号资料读取。 | 同 API Key 直连 |
| 复用本机 CLI 登录 | 使用 `kiro-cli login` 的现有登录。CLI 可用但 DSH 找不到时，在插件配置设原生二进制绝对路径 `cliPath`。 | ACP V3 文本与思考增量 |
| Kiro CLI 独立登录 | 在终端将 `KIRO_HOME` 指到设置页显示的目录，再运行 `kiro-cli login`。进入官方界面选择 Builder ID、Google、GitHub、IAM Identity Center 或组织身份提供商。 | ACP V3 文本与思考增量 |
| Kiro API Key（CLI） | 在 DSH 凭据中保存 Key，只把引用名填入设置，默认 `KIRO_API_KEY`。Key 通过子进程环境传给官方无交互模式。 | 完成后返回文本 |

点击 **刷新模型**，按需启停模型，再从 DSH 的 **Kiro Provider** 分组选择。设置页分四个 tab：**概览**（连接状态与额度）、**模型**、**连接与登录**、**高级**。模型目录与额度保存在本地快照中：重启后设置页立即显示上次结果，陈旧数据在后台自动补采，刷新失败保留上次成功目录并给出提示。

**额度面板**：直连三种模式（浏览器登录、API Key、会话凭据）以指标卡显示套餐名与 credits 窗口——月度额度、超额上限（启用 overage 时）、赠送额度与免费试用，含活倒计时与用量严重度提示（即将用尽/已用尽）；额度按高级设置的间隔自动刷新，连续失败 6 次后暂停，点击 **刷新额度** 恢复。CLI 连接模式的额度在 Kiro 账户页查看。模型行以徽标标注 Kiro 公布的扣费倍率（如 `x1.30`，按消耗高低着色）。

**模型管理**：显示名自动清理 ID 格式（如 `claude-sonnet-5.5` → Claude Sonnet 5.5，请求 ID 保留在副行）；每行以徽标标注扣费倍率（`x1.30`，按消耗高低着色），会话模型选择器同步显示核心原生倍率徽标；同家族存在更新版本或经核实已弃用的旧版模型默认关闭并挂「旧版」标记，可手动开启；「恢复推荐」一键回到推荐列表。名称/ID 搜索、启用计数、默认 6 条折叠展开；模型行的「默认设置」可保存默认思考档位与输出上限（直连模式），调用时只填充未显式指定的参数。会话输入栏的上下文 pill 显示所选 Kiro 模型的上下文窗口，并可一键切换本会话的思考档位。

**高级设置**：额度自动刷新间隔、流空闲超时、请求图片大小上限、登录时自动打开浏览器（默认开启，仅打开 Kiro/AWS 官方授权页）。浏览器登录成功后会自动打开默认浏览器完成授权，设置页同时保留可点击链接。

## 当前范围

- 直连模式通过 Kiro 的客户端接口读取账号模型目录、额度、发送对话和解码 AWS 事件流。客户端接口变动可能影响接入。直连不会回落到其他客户端或修改客户端标识。
- 本地快照（`storages/dsh-kiro-provider/state.json`，可用配置 `statePath` 改位置）只存模型目录与额度等派生数据，不含凭据；设置保存在插件配置，凭据保存在 DSH 凭据。
- 手动会话凭据为 JSON 字符串：`accessToken`（访问令牌）、`profileArn`（Kiro 账号资料 ARN）、`expiresAt`（Unix 毫秒时间戳）、`method`（`social` 或 `sso`）。仅在 DSH 凭据中填写。手动会话过期后须更新凭据。
- CLI 三种模式需要 Kiro CLI `3.5+`，每轮使用新 Kiro 会话、传入 DSH 文本转录，不支持新的 DSH 工具调用、图片、原生会话续接或可配置的输出上限。
- CLI 模式使用不含 Hooks 和全局 MCP 的 Kiro 登录配置，并关闭 Kiro Web 的 **Apply your cloud configuration to local sessions**。Kiro CLI 管理会话、日志和浏览器登录。独立登录在插件目录下保存 Kiro 状态。
- Alpha 2 的网关模式会迁移到 API Key 直连模式，需要配置 Kiro 凭据后重新刷新模型。模型 ID 从带网关前缀的 ID 改为 Kiro 原始目录 ID，使用旧目录的会话需重新选择模型。

## 开发

运行 `npm ci --ignore-scripts`、`npm run check`，再用 `npm pack --ignore-scripts` 生成 Bundle。源码结构和边界见 [设计说明](docs/design.md)。
