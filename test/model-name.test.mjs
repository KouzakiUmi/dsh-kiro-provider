import assert from 'node:assert/strict';
import test from 'node:test';
import { readableModelName, modelRateBadge, selectorRateBadge, legacyModelIds, supersededBy, legacySuccessor } from '../src/model-name.mjs';
import { effectiveContextWindow, contextTierOptions, CONTEXT_TIERS } from '../src/remote.mjs';

test('ID 格式显示名清理为可读品牌名，请求 ID 不受影响', () => {
  const cases = [
    ['claude-sonnet-5.5', 'Claude Sonnet 5.5'], ['claude-opus-4.8', 'Claude Opus 4.8'],
    ['claude-sonnet-4-5', 'Claude Sonnet 4.5'], ['gpt-5.6-sol', 'GPT 5.6 Sol'],
    ['grok-4.7', 'Grok 4.7'], ['kimi-k3', 'Kimi K3'], ['minimax-m2.5', 'MiniMax M2.5'],
    ['glm-5', 'GLM 5'], ['deepseek-3.2', 'DeepSeek 3.2'], ['qwen3-coder-next', 'Qwen 3 Coder Next'],
    ['auto', 'Auto'],
  ];
  for (const [id, expected] of cases) assert.equal(readableModelName(id, id), expected, id);
  assert.equal(readableModelName('CLAUDE-OPUS-4.5', 'CLAUDE-OPUS-4.5'), 'Claude Opus 4.5');
  assert.equal(readableModelName('x', 'Custom Name'), 'Custom Name');
  assert.equal(readableModelName('', ''), '未命名模型');
});

test('倍率徽标格式与消耗色调', () => {
  assert.deepEqual(modelRateBadge(1.3), { label: 'x1.30', tone: 'info', multiplier: 1.3 });
  assert.deepEqual(modelRateBadge(0.06), { label: 'x0.06', tone: 'success', multiplier: 0.06 });
  assert.deepEqual(modelRateBadge(4.4), { label: 'x4.40', tone: 'warning', multiplier: 4.4 });
  assert.equal(modelRateBadge(2).label, 'x2.00');
  for (const bad of [0, -1, NaN, null, '1.3']) assert.equal(modelRateBadge(bad), null);
});

test('选择器徽标走核心 LlmModelInfo.badge 契约，未知不挂', () => {
  assert.deepEqual(selectorRateBadge(1.3), { text: { en: 'x1.30', zh: 'x1.30' }, tone: 'neutral' });
  assert.deepEqual(selectorRateBadge(0.06), { text: { en: 'x0.06', zh: 'x0.06' }, tone: 'neutral' });
  for (const bad of [0, -1, NaN, undefined, null, '1.3']) assert.equal(selectorRateBadge(bad), undefined);
});

test('上下文档位按原生窗口封顶，快捷档只列低于原生的', () => {
  assert.equal(effectiveContextWindow(1000000, 'standard'), 256000);
  assert.equal(effectiveContextWindow(1000000, 'extended'), 500000);
  assert.equal(effectiveContextWindow(1000000, 'maximum'), 1000000);
  assert.equal(effectiveContextWindow(1000000, ''), 1000000);
  assert.equal(effectiveContextWindow(200000, 'maximum'), 200000);
  assert.equal(effectiveContextWindow(200000, undefined), 200000);
  assert.equal(effectiveContextWindow(0, 'standard'), undefined);
  assert.equal(effectiveContextWindow(undefined, 'standard'), undefined);
  assert.deepEqual(contextTierOptions(1000000), ['standard', 'extended']);
  assert.deepEqual(contextTierOptions(500000), ['standard']);
  assert.deepEqual(contextTierOptions(200000), []);
  assert.deepEqual(CONTEXT_TIERS, { standard: 256000, extended: 500000, maximum: 1000000 });
});

test('旧版判定：同家族更高版本 + 跨世代后继在目录内存在时压制；幸存者不被外部表误伤', () => {
  const ids = ['auto', 'claude-opus-5.5', 'claude-sonnet-5.5', 'claude-haiku-5.5',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'grok-4.7', 'kimi-k3',
    'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4.8', 'claude-opus-4.7', 'claude-opus-4.6',
    'claude-sonnet-4.6', 'claude-opus-4.5', 'claude-sonnet-4.5', 'claude-haiku-4.5',
    'deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next'];
  const legacy = legacyModelIds(ids.map(id => ({ id })));
  assert.deepEqual(legacy.sort(), [
    // 同家族更高版本（目录内规则）。
    'claude-haiku-4.5', 'claude-opus-4.5', 'claude-opus-4.6', 'claude-opus-4.7', 'claude-opus-4.8',
    'claude-opus-5', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'claude-sonnet-5', 'minimax-m2.1',
  ].sort());
  // 跨世代外部后继：目录内没有后继型号时绝不压制（厂商侧弃用不等于 Kiro 侧弃用）。
  assert.deepEqual(legacyModelIds([{ id: 'gpt-5.6-sol' }]), []);
  assert.deepEqual(legacyModelIds([{ id: 'gpt-5.6-sol' }, { id: 'gpt-6.2-sol' }]), ['gpt-5.6-sol']);
  assert.deepEqual(legacyModelIds([{ id: 'deepseek-3.2' }, { id: 'deepseek-v4-flash' }]), ['deepseek-3.2']);
  assert.deepEqual(legacyModelIds([{ id: 'deepseek-3.2' }]), []);
  assert.deepEqual(legacyModelIds([{ id: 'minimax-m2.5' }, { id: 'minimax-m3.1-flash' }]), ['minimax-m2.5']);
  assert.equal(supersededBy('gpt-5.6-sol'), 'GPT-6.2 Sol');
  assert.equal(supersededBy('kimi-k3'), 'Kimi K3.1 Pro');
  assert.equal(supersededBy('grok-4.7'), undefined);
  assert.equal(supersededBy('claude-opus-5.5'), undefined);
  // 目录缩水场景（2026-11-27 实测服务端仅返回 7 个开放权重模型）：仅 minimax-m2.1 被同家族压制，其余幸存者保持默认开启。
  const shrunken = ['grok-4.7', 'kimi-k3', 'deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next'];
  assert.deepEqual(legacyModelIds(shrunken.map(id => ({ id }))).sort(), ['minimax-m2.1']);
  // 变体不互相压制（虚构家族，不在外部表内）。
  assert.deepEqual(legacyModelIds([{ id: 'foo-5.6-sol' }, { id: 'foo-5.6-terra' }]), []);
  assert.deepEqual(legacyModelIds([{ id: 'grok-4.7' }]), []);
  // 连字符版本与点版本同族。
  assert.deepEqual(legacyModelIds([{ id: 'claude-sonnet-4-5' }, { id: 'claude-sonnet-5.5' }]), ['claude-sonnet-4-5']);
  assert.deepEqual(legacyModelIds([]), []);
});

test('外部后继前缀闸门：前缀命中即压制，缺失不压制，大小写不敏感', () => {
  const rows = ids => ids.map(id => ({ id }));
  // 每个已登记前缀分支逐一验证（表驱动）。
  const cases = [
    ['deepseek-3.2', 'deepseek-v4.1-flash', 'deepseek-4-pro'],
    ['glm-5', 'glm-5.3', 'glm-6-flash'],
    ['kimi-k3', 'kimi-k3.1-pro', 'kimi-k4'],
    ['minimax-m2.5', 'minimax-m3.1-flash', null],
    ['qwen3-coder-next', 'qwen4-max', null],
  ];
  for (const [legacyId, first, second] of cases) {
    assert.deepEqual(legacyModelIds(rows([legacyId])), [], `${legacyId} alone`);
    assert.deepEqual(legacyModelIds(rows([legacyId, first])), [legacyId], `${legacyId} with ${first}`);
    if (second) assert.deepEqual(legacyModelIds(rows([legacyId, second])), [legacyId], `${legacyId} with ${second}`);
  }
  // 大小写不敏感。
  assert.deepEqual(legacyModelIds(rows(['GPT-5.6-SOL', 'GPT-6.2-SOL'])), ['GPT-5.6-SOL']);
  // 同代变体上架即压制整代：仅 gpt-6.2-sol 在目录时其余 5.6 变体也被压（世代语义）。
  assert.deepEqual(legacyModelIds(rows(['gpt-5.6-terra', 'gpt-6.2-sol'])), ['gpt-5.6-terra']);
});

test('legacySuccessor 仅在外部压制生效时返回后继，同家族压制回退 null', () => {
  const rows = ids => ids.map(id => ({ id }));
  // 外部压制生效：后继在目录。
  assert.equal(legacySuccessor(rows(['gpt-5.6-sol', 'gpt-6.2-sol']), 'gpt-5.6-sol'), 'GPT-6.2 Sol');
  // 后继缺席：压制未生效，即使有外部表项也回退 null。
  assert.equal(legacySuccessor(rows(['minimax-m2.1', 'minimax-m2.5']), 'minimax-m2.1'), null);
  // 无外部表项的纯同家族压制。
  assert.equal(legacySuccessor(rows(['claude-sonnet-5', 'claude-sonnet-5.5']), 'claude-sonnet-5'), null);
  assert.equal(legacySuccessor(rows([]), 'gpt-5.6-sol'), null);
  assert.equal(legacySuccessor(null, 'gpt-5.6-sol'), null);
});
