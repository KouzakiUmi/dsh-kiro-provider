import { KiroProblem } from './cli.mjs';
import { openDirectStream } from './direct-http.mjs';
import { directWire } from './direct-wire.mjs';
import { messagesResponse } from './direct-stream.mjs';

const sdkOrigin = 'https://dsh-kiro-adapter.invalid';
const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function directFetch({ row, credential, tuning, fetcher, onFailure }) {
  return async (input, init) => {
    try {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin !== sdkOrigin || url.pathname !== '/v1/messages' || request.method !== 'POST') throw new KiroProblem('Kiro SDK 请求格式错误。', 'INVALID_REQUEST');
      const { wire, names } = directWire(await request.json(), row, tuning);
      const cancel = new AbortController();
      const signal = AbortSignal.any([request.signal, cancel.signal]);
      const body = await openDirectStream({ ...(await credential(signal)), wire, signal, fetcher });
      return messagesResponse(body, row, names.reverse, { onFailure, signal, cancel: () => cancel.abort() });
    } catch (error) {
      if (error instanceof KiroProblem) onFailure?.(error);
      throw error;
    }
  };
}

export function directProfile(row, route, retryPolicy, tuning = {}) {
  const model = { id: row.id, name: row.name, api: 'anthropic-messages', provider: route, baseUrl: sdkOrigin,
    input: row.inputModalities, output: ['text'], contextWindow: tuning.contextWindow ?? row.contextWindow, maxTokens: row.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: row.efforts.length > 0,
    thinkingLevelMap: Object.fromEntries(levels.map(level => [level, level === 'off' ? undefined : row.efforts.includes(level) ? level : null])),
    // Kiro's bridge emits unsigned thinking. Keep it typed in the local Messages
    // request so directWire drops it rather than forwarding it as assistant text.
    compat: { allowEmptySignature: true, ...(row.efforts.length ? { forceAdaptiveThinking: true } : {}) },
  };
  return { baseURL: sdkOrigin, provider: route, displayName: 'Kiro Provider', models: [model], modelErrors: new Map(), configuredMaxTokens: new Map(),
    streamIdleTimeoutMs: tuning.streamIdleTimeoutMs ?? 180_000, maxRequestImageBytes: tuning.maxRequestImageBytes ?? 10_000_000,
    requestImagePixelBudget: 4_000_000, requestImageMaxBytes: 3_750_000, retryPolicy };
}
