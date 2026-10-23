process.env.JWT_SECRET = 't'; process.env.INGEST_API_KEYS = 'k';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../src/utils/template');
const { redactSecrets, redactHeaders } = require('../src/utils/redact');
const { encrypt, decrypt } = require('../src/utils/crypto');
const { matches } = require('../src/services/routing');
const { evaluate, buildRequest } = require('../src/services/executor');
const presets = require('../src/services/presets');

const ctx = { lead: { name: 'Rahul', mobile: '9876543210', course: 'B.Com' }, campaign: { name: 'Rathinam B.Com', source: 'collegedunia' }, client: { collegeId: '450' }, secrets: { accessKey: 'AK-123456' } };

test('template keeps types and interpolates text', () => {
  const out = render({ a: '{{lead.name}}', b: 'Hi {{lead.name}}', c: '{{lead}}', d: ['{{client.collegeId}}'] }, ctx);
  assert.strictEqual(out.a, 'Rahul');
  assert.strictEqual(out.b, 'Hi Rahul');
  assert.deepStrictEqual(out.c, ctx.lead);
  assert.deepStrictEqual(out.d, ['450']);
});

test('crypto round trip', () => assert.strictEqual(decrypt(encrypt('s3cret!')), 's3cret!'));

test('secrets never survive redaction', () => {
  const r = redactSecrets({ url: 'x?k=AK-123456', h: 'AK-123456' }, ['AK-123456']);
  assert.ok(!JSON.stringify(r).includes('AK-123456'));
  assert.strictEqual(redactHeaders({ 'access-key': 'z', Accept: 'a' })['access-key'], '***');
});

test('routing: all/any/in', () => {
  const lead = { college: 'Rathinam', course: 'B.Com', state: 'Tamil Nadu' };
  const rule = (match, conditions) => ({ match, conditions });
  assert.ok(matches(rule('all', [{ field: 'college', op: 'eq', value: 'rathinam' }, { field: 'course', op: 'eq', value: 'B.Com' }]), lead));
  assert.ok(!matches(rule('all', [{ field: 'college', op: 'eq', value: 'ABC' }, { field: 'course', op: 'eq', value: 'B.Com' }]), lead));
  assert.ok(matches(rule('any', [{ field: 'college', op: 'eq', value: 'ABC' }, { field: 'state', op: 'in', value: 'Kerala, Tamil Nadu' }]), lead));
});

test('response evaluation: status + body path + external id', () => {
  const c = { responseMapping: { successPath: 'data[0].code', successValue: 'SUCCESS', externalIdPath: 'data[0].details.id' } };
  const ok = evaluate(c, 200, { data: [{ code: 'SUCCESS', details: { id: 42 } }] });
  assert.ok(ok.ok); assert.strictEqual(ok.externalId, '42');
  assert.ok(!evaluate(c, 200, { data: [{ code: 'DUPLICATE_DATA', message: 'dup' }] }).ok);
  assert.ok(!evaluate({}, 500, {}).ok);
});

test('every preset renders valid JSON with secrets resolved', () => {
  for (const [k, p] of Object.entries(presets)) {
    p.apiUrl ||= 'https://example.com/x';
    const req = buildRequest({ ...p, method: p.method }, ctx);
    assert.ok(req.url.startsWith('https://'), k);
    JSON.stringify(req.body);
  }
});
