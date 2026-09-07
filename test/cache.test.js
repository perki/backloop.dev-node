const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// These cover the defect where configuring a secret after running on the public
// certificate kept serving the public one: the cache was still valid, so nothing
// went and fetched the certificate the user had just been given access to.
let sandbox;
let saved;

function pack (overrides = {}) {
  const future = new Date(Date.now() + 400 * 864e5).toISOString();
  return JSON.stringify({
    version: { num: '1', message: '' },
    domain: 'backloop.dev',
    cert: 'CERT',
    ca: 'CA',
    key1: 'K1',
    key2: 'K2',
    info: { issuer: { commonName: 'x' }, domains: { commonName: '*.backloop.dev', altNames: [] }, notAfter: future },
    ...overrides
  });
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'backloop-cache-'));
  fs.mkdirSync(path.join(sandbox, 'certs'));
  fs.mkdirSync(path.join(sandbox, 'home'));
  saved = {
    BACKLOOPDEV: process.env.BACKLOOPDEV,
    BACKLOOP_DEV_SECRET: process.env.BACKLOOP_DEV_SECRET,
    BACKLOOP_DEV_CERTS_DIR: process.env.BACKLOOP_DEV_CERTS_DIR,
    BACKLOOP_DEV_CERT: process.env.BACKLOOP_DEV_CERT,
    BACKLOOP_DEV_KEY: process.env.BACKLOOP_DEV_KEY,
    INIT_CWD: process.env.INIT_CWD,
    HOME: process.env.HOME
  };
  delete process.env.BACKLOOPDEV;
  delete process.env.BACKLOOP_DEV_SECRET;
  delete process.env.BACKLOOP_DEV_CERT;
  delete process.env.BACKLOOP_DEV_KEY;
  process.env.BACKLOOP_DEV_CERTS_DIR = path.join(sandbox, 'certs');
  process.env.INIT_CWD = sandbox;
  process.env.HOME = path.join(sandbox, 'home');
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function load () {
  for (const m of ['../src/secret', '../src/localcert', '../src/notice', '../src/check']) {
    delete require.cache[require.resolve(m)];
  }
  return require('../src/check');
}

const certs = () => path.join(sandbox, 'certs');
const write = (rel, content) => {
  const f = path.join(certs(), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};

describe('the cache is kept per source', () => {
  it('reads the public cache when no secret is configured', () => {
    write('public/pack.json', pack({ public: true }));
    write('private/pack.json', pack({ info: { issuer: { commonName: 'private' }, domains: { commonName: 'x', altNames: [] }, notAfter: new Date(Date.now() + 400 * 864e5).toISOString() } }));
    assert.strictEqual(load().loadFromLocalDirectory('')?.public, true);
  });

  it('reads the private cache once a secret is configured', () => {
    process.env.BACKLOOPDEV = 'abcdefgh12345678';
    write('public/pack.json', pack({ public: true }));
    write('private/pack.json', pack({ domain: 'private-one' }));
    const got = load().loadFromLocalDirectory('');
    assert.strictEqual(got.domain, 'private-one');
    assert.notStrictEqual(got.public, true);
  });

  it('does not see a private cache as a substitute for the public one', () => {
    write('private/pack.json', pack({ domain: 'private-one' }));
    assert.strictEqual(load().loadFromLocalDirectory(''), null);
  });

  it('keeps the two apart on disk, so neither overwrites the other', () => {
    write('public/pack.json', pack({ public: true, domain: 'pub' }));
    write('private/pack.json', pack({ domain: 'priv' }));
    assert.strictEqual(load().loadFromLocalDirectory('').domain, 'pub');
    process.env.BACKLOOPDEV = 'abcdefgh12345678';
    assert.strictEqual(load().loadFromLocalDirectory('').domain, 'priv');
  });
});

describe('a pack sitting directly in the certificates directory', () => {
  it('is used when nothing else applies, which is the documented offline path', () => {
    write('pack.json', pack({ domain: 'supplied' }));
    assert.strictEqual(load().loadFromLocalDirectory('').domain, 'supplied');
  });

  it('loses to the cache for the current source', () => {
    write('pack.json', pack({ domain: 'supplied' }));
    write('public/pack.json', pack({ public: true, domain: 'cached' }));
    assert.strictEqual(load().loadFromLocalDirectory('').domain, 'cached');
  });

  it('is ignored when it is public and a secret is now configured', () => {
    // An older version cached the public certificate here. Serving it after the
    // user has been given a secret is the defect this whole split exists to stop.
    process.env.BACKLOOPDEV = 'abcdefgh12345678';
    write('pack.json', pack({ public: true, domain: 'stale-public' }));
    assert.strictEqual(load().loadFromLocalDirectory(''), null);
  });

  it('is still honoured when it is not public and a secret is configured', () => {
    process.env.BACKLOOPDEV = 'abcdefgh12345678';
    write('pack.json', pack({ domain: 'supplied-private' }));
    assert.strictEqual(load().loadFromLocalDirectory('').domain, 'supplied-private');
  });

  it('is ignored when it is not readable, rather than crashing', () => {
    write('pack.json', 'not json at all');
    assert.strictEqual(load().loadFromLocalDirectory(''), null);
  });
});
