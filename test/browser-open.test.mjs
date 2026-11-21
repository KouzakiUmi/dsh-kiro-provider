import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOpenUrl, openBrowser } from '../src/browser-open.mjs';

test('only Kiro and AWS authorization URLs may be opened', () => {
  assert.equal(validateOpenUrl('https://app.kiro.dev/signin?state=x&code_challenge=y'), true);
  assert.equal(validateOpenUrl('https://oidc.us-east-1.amazonaws.com/authorize?state=x'), true);
  for (const url of [
    'https://app.kiro.dev.evil.example/signin', 'http://app.kiro.dev/signin',
    'https://oidc.us-east-1.amazonaws.com.evil.example/authorize',
    'https://user:pass@app.kiro.dev/signin', 'https://app.kiro.dev:8443/signin',
    'https://app.kiro.dev/other', 'javascript:alert(1)', '', null,
  ]) assert.equal(validateOpenUrl(url), false, url);
});

test('openBrowser spawns the platform opener without a shell and never for invalid URLs', () => {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { once: () => {}, unref: () => {} };
  };
  assert.equal(openBrowser('https://evil.example/', { spawn }), false);
  assert.deepEqual(calls, []);
  assert.equal(openBrowser('https://app.kiro.dev/signin?state=x', { spawn, platform: 'win32' }), true);
  assert.equal(calls[0].cmd, 'rundll32');
  assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', 'https://app.kiro.dev/signin?state=x']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(openBrowser('https://oidc.eu-central-1.amazonaws.com/authorize?x=1', { spawn, platform: 'darwin' }), true);
  assert.equal(calls[1].cmd, 'open');
  assert.equal(openBrowser('https://app.kiro.dev/signin', { spawn, platform: 'linux' }), true);
  assert.equal(calls[2].cmd, 'xdg-open');
});