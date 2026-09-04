const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ENTRY = path.join(__dirname, '..', 'src', 'index.mjs');

describe('the ESM entry', () => {
  it('exports the three functions by name', async () => {
    const mod = await import(ENTRY);
    for (const name of ['httpsOptions', 'httpsOptionsAsync', 'httpsOptionsPromise']) {
      assert.strictEqual(typeof mod[name], 'function', name);
    }
  });

  it('defaults to the same three, mirroring require()', async () => {
    const { default: api } = await import(ENTRY);
    assert.deepStrictEqual(
      Object.keys(api).sort(),
      ['httpsOptions', 'httpsOptionsAsync', 'httpsOptionsPromise']
    );
  });

  it('resolves nothing when imported', async () => {
    // The whole point of 5.0.0: before, importing fetched over the network, so
    // a production build paid for a certificate it never used and a config file
    // could not load the module at all.
    const before = Date.now();
    await import(ENTRY + '?fresh=' + before);
    assert.ok(Date.now() - before < 2000, 'import should not have performed a request');
  });

  it('explains itself when version 4 code passes the default to createServer', async () => {
    // https.createServer reads these three. Throwing here beats starting a
    // server with no certificate and failing somewhere far from the cause.
    const { default: api } = await import(ENTRY);
    for (const field of ['key', 'cert', 'ca']) {
      assert.throws(() => api[field], /httpsOptionsPromise/, field);
    }
  });
});
