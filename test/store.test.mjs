import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStore } from '../src/store.mjs';
import { validateCatalog } from '../src/catalog.mjs';

const validate = (kind, value) => kind === 'catalog' ? validateCatalog(value) : undefined;
const catalog = id => ({ rows: [{ id, name: id, efforts: [] }], cli: null });
const tempFile = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-kiro-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, 'state.json') };
};

test('store persists atomically, validates entries and tolerates corruption', async t => {
  const { dir, file } = await tempFile(t);
  const store = createStore({ file, validate });
  await store.load();
  assert.equal(store.get('catalog', 'k'), undefined);
  await store.set('catalog', 'k', catalog('m'));
  assert.deepEqual((await readdir(dir)).sort(), ['state.json']);
  const again = createStore({ file, validate });
  await again.load();
  assert.equal(again.get('catalog', 'k').value.rows[0].id, 'm');
  await assert.rejects(store.set('catalog', 'bad', { rows: [], cli: null }), /快照无效/);
  await assert.rejects(store.set('unknown', 'k', {}), /快照无效/);
  await writeFile(file, '{broken');
  const broken = createStore({ file, validate });
  await broken.load();
  assert.equal(broken.get('catalog', 'k'), undefined);
  await broken.set('catalog', 'k2', catalog('n'));
  assert.equal(broken.get('catalog', 'k2').value.rows[0].id, 'n');
  store.dispose();
  await assert.rejects(store.set('catalog', 'k3', catalog('x')), /已关闭/);
});

test('store serializes writes and merges entries from other instances', async t => {
  const { file } = await tempFile(t);
  const a = createStore({ file, validate });
  const b = createStore({ file, validate });
  await a.load();
  await b.load();
  await Promise.all([a.set('catalog', 'one', catalog('a')), b.set('catalog', 'two', catalog('b'))]);
  await a.whenIdle();
  await b.whenIdle();
  const reader = createStore({ file, validate });
  await reader.load();
  assert.equal(reader.get('catalog', 'one').value.rows[0].id, 'a');
  assert.equal(reader.get('catalog', 'two').value.rows[0].id, 'b');
  await a.remove('catalog', 'one');
  const after = createStore({ file, validate });
  await after.load();
  assert.equal(after.get('catalog', 'one'), undefined);
  assert.equal(after.get('catalog', 'two').value.rows[0].id, 'b');
  // Invalidation hides the entry from reads immediately, before the disk write settles.
  b.invalidate('catalog', 'two');
  assert.equal(b.get('catalog', 'two'), undefined);
  await b.whenIdle();
  const final = createStore({ file, validate });
  await final.load();
  assert.equal(final.get('catalog', 'two'), undefined);
});

test('store lock contention fails bounded without touching the file', async t => {
  const { file } = await tempFile(t);
  const store = createStore({ file, validate });
  await store.load();
  await store.set('catalog', 'k', catalog('m'));
  await writeFile(`${file}.lock`, '');
  await assert.rejects(store.set('catalog', 'k', catalog('changed')), /其他实例/);
  const reader = createStore({ file, validate });
  await reader.load();
  assert.equal(reader.get('catalog', 'k').value.rows[0].id, 'm');
});