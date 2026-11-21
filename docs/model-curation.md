# 模型策展：旧版判定来源

> 2026-11-21 核验。旧版默认关闭 = 已核实外部后继关系（`model-name.mjs` SUPERSEDED 表）+ 目录内同家族更高版本。
> 用户显式开关优先；「恢复推荐」清除手动开关回到本表推荐。

## 核验方法

直接访问 Artificial Analysis 排行榜（`https://artificialanalysis.ai/leaderboards/models`，curl 抓取页面内嵌 JSON，536 条发布记录），读取每条的 `deprecated` 标志与 `releaseDate`；Kimi 无 AA 条目，用官方开放平台文档直接核实。不依赖搜索摘要（可能缓存过时）。

## 逐条证据（Kiro 目录 23 模型）

### 默认关闭（18）

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

### 默认开启（5）

| Kiro ID | 依据 |
|---|---|
| auto | Kiro 自动路由元模型，非具体旧版 |
| claude-opus-5.5 | AA `claude-opus-5-5` deprecated=false（2026-09-22） |
| claude-sonnet-5.5 | AA `claude-sonnet-5-5` deprecated=false（2026-09-28） |
| claude-haiku-5.5 | AA `claude-haiku-5-5` deprecated=false（2026-10-07） |
| grok-4.7 | AA `grok-4-7` deprecated=false（2026-09-21）；AWS Bedrock 模型卡 lifecycle=Active，EOL 不早于 2027-09-28 |

## 维护约定

- 目录刷新发现新 ID 时：先按同家族版本推断；跨世代替代（如 GPT-5.6→6.x）须核实 AA deprecated 标志或厂商文档后登记 SUPERSEDED 表，并更新本文件。
- 变体型号（sol/terra/luna 等同代不同档）不互相压制；外部表按完整 ID 精确匹配。
- 本表只影响**默认**启停；用户显式开关始终优先。