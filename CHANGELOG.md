# Changelog

## 0.1.4

- Fixed legacy curation hiding every surviving model when the server-side catalog shrinks. External cross-generation succession (GPT-5.6→6.x, DeepSeek 3.2→V4.x, etc.) now applies only when the successor is actually present in the account's catalog; vendor-side deprecation no longer suppresses models Kiro still serves. Same-family suppression within the catalog is unchanged.
- Widened CLI compatibility to the 2.x final line: Kiro CLI 2.37+ is accepted alongside 3.x (the V3 engine the plugin uses shipped in 2.37). Older 2.x and 1.x remain rejected.
- CLI discovery now falls back to the Windows desktop-app layout `%LOCALAPPDATA%\kiro-cli\run\chat-cli-<version>.exe` when no `kiro-cli` is on PATH, accepting the versioned kernel name in configured `cliPath` as well.
- Catalog parsing regression-covered against the observed CLI JSON shape (`model_id`/`model_name`/`rate_multiplier`).

## 0.1.3

- Fixed Kiro direct connections replaying unsigned thinking as assistant text on later turns. The current turn still displays thinking separately, and tool-result replay is unchanged.
