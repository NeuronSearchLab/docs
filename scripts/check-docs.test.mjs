import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditDirectory, publicPolicyErrors } from './check-docs.mjs';

test('rejects hosting names, private paths, vendor extensions and raw commit links', () => {
  for (const text of ['We run on AWS.', 'Cognito auth', 'We are hosted on Vercel.', 'ECS deployment', 'arn:aws:example', 'x-amazon-apigateway-integration', '/Users/person/repo', 'https://github.com/example/private/commit/123']) assert.ok(publicPolicyErrors(text, 'test.mdx').length, text);
});
test('preserves relevant recommendation architectures and customer integrations', () => {
  assert.deepEqual(publicPolicyErrors('SASRec, BERT4Rec, LightGCN, XGBoost, a two-tower model; connect your Shopify or Vercel project.', 'test.mdx'), []);
});
async function fixture(t, { body = '## Start\n\nRead [this](#start).', redirects = [], extra = {} } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nsl-docs-check-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'docs.json'), JSON.stringify({ navigation: { pages: ['intro'] }, redirects }));
  await writeFile(path.join(dir, '.mintignore'), 'scripts/\n.github/\nREADME.md\nnode_modules/\n');
  await writeFile(path.join(dir, 'intro.mdx'), '---\ntitle: Intro\ndescription: Intro\n---\n' + body);
  for (const [file, text] of Object.entries(extra)) { await mkdir(path.dirname(path.join(dir, file)), {recursive:true}); await writeFile(path.join(dir, file), text); }
  return auditDirectory(dir);
}
test('valid page and redirect pass', async t => assert.deepEqual((await fixture(t, { redirects: [{source:'/old',destination:'/intro'}] })).errors, []));
test('broken pages and anchors fail', async t => {
  const { errors } = await fixture(t, { body: '[missing](/absent)\n[anchor](#absent)' });
  assert.ok(errors.some(e => e.includes('broken local link')));
  assert.ok(errors.some(e => e.includes('missing anchor')));
});
test('malformed MDX and JSON examples fail', async t => {
  assert.ok((await fixture(t, {body:'<Broken>'})).errors.some(e=>e.includes('MDX/frontmatter')));
  assert.ok((await fixture(t, {body:'```json\n{"a":}\n```'})).errors.some(e=>e.includes('invalid JSON example')));
});
test('redirect cycles fail', async t => assert.ok((await fixture(t, {redirects:[{source:'/a',destination:'/b'},{source:'/b',destination:'/a'}]})).errors.some(e=>e.includes('chain or cycle'))));
test('unlinked public files are still scanned', async t => assert.ok((await fixture(t, {extra:{'unused.json':'{"host":"amazonaws.com"}'}})).errors.some(e=>e.includes('public-content policy'))));


test('an unlisted page cannot silently become public content', async t => {
  const { errors } = await fixture(t, { extra: { 'forgotten.mdx': '---\ntitle: Forgotten\ndescription: Forgotten\n---\nUnlisted page.' } });
  assert.ok(errors.some(e => e.includes('page is not in navigation')));
});
test('every public API operation needs a matching reference page', async t => {
  const spec = { openapi: '3.0.3', info: { title: 'Example', version: '1' }, paths: { '/v1/items': { get: { responses: { '200': { description: 'OK' } } } } } };
  const { errors } = await fixture(t, { extra: { 'api-reference/openapi.json': JSON.stringify(spec) } });
  assert.ok(errors.some(e => e.includes('operation without a page: GET /v1/items')));
});
