# 模型策展：旧版判定来源

> 2026-11-21 核验。旧版默认关闭 = 目录内同家族更高版本 + 跨世代外部后继**在目录内实际存在**（`model-name.mjs` SUPERSEDED 表按已核实 ID 前缀判定）。
> 用户显式开关优先；「恢复推荐」清除手动开关回到本表推荐。
> 2026-11-28 语义修正：厂商侧弃用不等于 Kiro 侧弃用。目录缩水时（实测服务端目录收缩到 7 个开放权重模型），
> 外部表不再压制幸存者——幸存型号可能是该账号唯一可用模型。注意 GPT 变体（`-sol` 等尾段非版本号）不受同家族规则覆盖，
> 其压制唯一途径是外部前缀表；Claude 同代替代则由目录内同家族版本规则覆盖。

## 核验方法

直接访问 Artificial Analysis 排行榜（`https://artificialanalysis.ai/leaderboards/models`，curl 抓取页面内嵌 JSON，536 条发布记录），读取每条的 `deprecated` 标志与 `releaseDate`；Kimi 无 AA 条目，用官方开放平台文档直接核实。不依赖搜索摘要（可能缓存过时）。

## 逐条证据（Kiro 目录 23 模型）

### 厂商侧弃用证据（SUPERSEDED 表与同家族规则的来源）

> 下表是厂商侧 deprecated 证据登记，不等于 Kiro 侧默认关闭结果。实际压制按两层规则：Claude 同族型号由目录内同家族版本规则压制（后继 5.5 在目录）；跨世代型号仅在后继实际出现在账号目录时压制——23 模型目录中 GPT-6.x/DeepSeek V4/GLM-5.3/K3.1/M3.1/Qwen4 均未上架，故该目录下这些行实际**默认开启**，仅 minimax-m2.1 因同目录 m2.5 被压。

| Kiro ID | 判定依据 | 现役后继 |
|---|---|---|
| claude-opus-4.5 | AA `claude-opus-4-5` deprecated=true（2025-11-24 发布） | Claude Opus 5.5 |
| claude-opus-4.6 | AA `claude-opus-4-6` deprecated=true（2026-02-05） | Claude Opus 5.5 |
| claude-opus-4.7 | AA `claude-opus-4-7` deprecated=true（2026-04-16） | Claude Opus 5.5 |
| claude-opus-4.8 | AA `claude-opus-4-8` deprecated=true（2026-05-28） | Claude Opus 5.5 |
| claude-opus-5 | AA `claude-opus-5` deprecated=true（2026-07-24） | Claude Opus 5.5 |
| claude-sonnet-4.5 | AA `claude-4-5-sonnet` deprecated=true（2025-09-29） | Claude Sonnet 5.5 |
| claude-sonnet-4.6 | AA `claude-sonnet-4-6` deprecated=true（2026-02-17） | Claude Sonnet 5.5 |
| claude-sonnet-5 | AA `claude-sonnet-5` deprecated=true（2026-06-30） | Claude Sonnet 5.5 |
| claude-haiku-4.5 | AA `claude-4-5-haiku` deprecated=true（2025-10-15） | Claude Haiku 5.5 |
| gpt-5.6-sol | AA `gpt-5-6-sol` deprecated=true（2026-07-09） | GPT-6.2 Sol（AA 现役，2026-11-17） |
| gpt-5.6-terra | AA `gpt-5-6-terra` deprecated=true（2026-07-09） | GPT-6.1 Terra（AA 现役，2026-10-26） |
| gpt-5.6-luna | AA `gpt-5-6-luna` deprecated=true（2026-07-09） | GPT-6 Luna（AA 现役，2026-09-22） |
| deepseek-3.2 | AA `deepseek-v3-2` deprecated=true（2025-12-01）；官方 API 文档现役仅 deepseek-flash（V4.1-Flash-1017）与 deepseek-v4-pro | DeepSeek V4.1 Flash 1017 |
| glm-5 | AA `glm-5` deprecated=true（2026-02-11） | GLM-5.3（AA 现役，2026-08-18） |
| kimi-k3 | 官方平台文档（platform.kimi.com/docs/models，直接访问）：K3.1 Pro 已正式发布，K3 列「上一代旗舰模型」 | Kimi K3.1 Pro |
| minimax-m2.5 | AA `minimax-m2-5` deprecated=true（2026-02-12）；厂商退役通知 2026-11-18 起 M2.5/M2.7 请求路由至 M3.1 Flash | MiniMax M3.1 Flash |
| minimax-m2.1 | AA `minimax-m2-1` deprecated=true（2025-12-23） | MiniMax M3.1 Flash |
| qwen3-coder-next | Qwen3-Coder 世代（2025-07）；AA 示 Qwen3.8 Max 已弃用、Qwen4 Max 现役（2026-11-16）；阿里云百炼文档（2026-11-16 更新）以 qwen3.8 为当前世代 | Qwen4 Max |

### 厂商侧现役证据（无弃用记录）

> 厂商侧现役 + Kiro 目录内无更高版本 ⇒ 默认开启。此外按新语义，上表中后继未在 Kiro 目录上架的跨世代型号（GPT-5.6 三型、deepseek-3.2、glm-5、kimi-k3、minimax-m2.5、qwen3-coder-next）在该目录下同样默认开启。

| Kiro ID | 依据 |
|---|---|
| auto | Kiro 自动路由元模型，非具体旧版 |
| claude-opus-5.5 | AA `claude-opus-5-5` deprecated=false（2026-09-22） |
| claude-sonnet-5.5 | AA `claude-sonnet-5-5` deprecated=false（2026-09-28） |
| claude-haiku-5.5 | AA `claude-haiku-5-5` deprecated=false（2026-10-07） |
| grok-4.7 | AA `grok-4-7` deprecated=false（2026-09-21）；AWS Bedrock 模型卡 lifecycle=Active，EOL 不早于 2027-09-28 |

## 维护约定

- 目录刷新发现新 ID 时：先按同家族版本推断；跨世代替代（如 GPT-5.6→6.x）须核实 AA deprecated 标志或厂商文档后登记 SUPERSEDED 表（含后继的 Kiro ID 前缀），并更新本文件。
- 外部表压制以「后继在目录内存在」为闸门：Kiro 从未上架后继时，旧型号保持默认开启；后继上架后旧型号自动转为默认关闭。
- 变体型号（sol/terra/luna 等同代不同档）不互相压制；外部表按完整 ID 精确匹配，后继按前缀匹配且大小写不敏感。
- 本表只影响**默认**启停；用户显式开关始终优先。