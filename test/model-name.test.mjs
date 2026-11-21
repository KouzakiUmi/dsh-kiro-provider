import assert from 'node:assert/strict';
import test from 'node:test';
import { readableModelName, modelRateBadge, legacyModelIds, supersededBy } from '../src/model-name.mjs';

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
  assert.deepEqual(modelRateBadge(1.3), { label: 'x1.3', tone: 'info', multiplier: 1.3 });
  assert.deepEqual(modelRateBadge(0.06), { label: 'x0.06', tone: 'success', multiplier: 0.06 });
  assert.deepEqual(modelRateBadge(4.4), { label: 'x4.4', tone: 'warning', multiplier: 4.4 });
  assert.equal(modelRateBadge(2).label, 'x2');
  for (const bad of [0, -1, NaN, null, '1.3']) assert.equal(modelRateBadge(bad), null);
});

test('旧版判定：已核实外部后继 + 同家族更高版本；变体与现役型号不受影响', () => {
  const ids = ['auto', 'claude-opus-5.5', 'claude-sonnet-5.5', 'claude-haiku-5.5',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'grok-4.7', 'kimi-k3',
    'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4.8', 'claude-opus-4.7', 'claude-opus-4.6',
    'claude-sonnet-4.6', 'claude-opus-4.5', 'claude-sonnet-4.5', 'claude-haiku-4.5',
    'deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next'];
  const legacy = legacyModelIds(ids.map(id => ({ id })));
  assert.deepEqual(legacy.sort(), [
    'claude-haiku-4.5', 'claude-opus-4.5', 'claude-opus-4.6', 'claude-opus-4.7', 'claude-opus-4.8',
    'claude-opus-5', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'claude-sonnet-5',
    'deepseek-3.2', 'glm-5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'kimi-k3',
    'minimax-m2.1', 'minimax-m2.5', 'qwen3-coder-next',
  ].sort());
  // 外部后继表：即使目录内没有更新版本也标记旧版，并给出已核实的现役后继。
  assert.deepEqual(legacyModelIds([{ id: 'gpt-5.6-sol' }]), ['gpt-5.6-sol']);
  assert.equal(supersededBy('gpt-5.6-sol'), 'GPT-6.2 Sol');
  assert.equal(supersededBy('kimi-k3'), 'Kimi K3.1 Pro');
  assert.equal(supersededBy('grok-4.7'), undefined);
  assert.equal(supersededBy('claude-opus-5.5'), undefined);
  // 变体不互相压制（虚构家族，不在外部表内）。
  assert.deepEqual(legacyModelIds([{ id: 'foo-5.6-sol' }, { id: 'foo-5.6-terra' }]), []);
  assert.deepEqual(legacyModelIds([{ id: 'grok-4.7' }]), []);
  // 连字符版本与点版本同族。
  assert.deepEqual(legacyModelIds([{ id: 'claude-sonnet-4-5' }, { id: 'claude-sonnet-5.5' }]), ['claude-sonnet-4-5']);
  assert.deepEqual(legacyModelIds([]), []);
});