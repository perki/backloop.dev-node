const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// localcert reads the environment, the working directory and HOME, so every
// test runs against a scratch copy of all three and restores what it changed.
let sandbox;
let saved;

/** A throwaway certificate and key, so the tests never depend on a real one. */
function makePair (dir, name, cn = '*.backloop.dev') {
  fs.mkdirSync(dir, { recursive: true });
  const cert = path.join(dir, name + '.crt');
  const key = path.join(dir, name + '.key');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '30',
    '-subj', '/CN=' + cn, '-addext', 'subjectAltName=DNS:' + cn,
    '-keyout', key, '-out', cert
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  return { cert, key };
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'backloop-localcert-'));
  fs.mkdirSync(path.join(sandbox, 'home'));
  fs.mkdirSync(path.join(sandbox, 'project'));
  fs.mkdirSync(path.join(sandbox, 'certs'));
  saved = {
    BACKLOOP_DEV_CERT: process.env.BACKLOOP_DEV_CERT,
    BACKLOOP_DEV_KEY: process.env.BACKLOOP_DEV_KEY,
    BACKLOOP_DEV_CA: process.env.BACKLOOP_DEV_CA,
    BACKLOOP_DEV_CERTS_DIR: process.env.BACKLOOP_DEV_CERTS_DIR,
    INIT_CWD: process.env.INIT_CWD,
    HOME: process.env.HOME
  };
  delete process.env.BACKLOOP_DEV_CERT;
  delete process.env.BACKLOOP_DEV_KEY;
  delete process.env.BACKLOOP_DEV_CA;
  process.env.BACKLOOP_DEV_CERTS_DIR = path.join(sandbox, 'certs');
  process.env.INIT_CWD = path.join(sandbox, 'project');
  process.env.HOME = path.join(sandbox, 'home');
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

// certsPath is captured when secret.js is first required, so the module has to
// be reloaded after BACKLOOP_DEV_CERTS_DIR changes.
function load () {
  delete require.cache[require.resolve('../src/secret')];
  delete require.cache[require.resolve('../src/localcert')];
  return require('../src/localcert');
}

describe('no local certificate configured', () => {
  it('returns null rather than throwing, so the caller can go on to download one', () => {
    assert.strictEqual(load().loadLocalCert(), null);
  });
});

describe('certificate paths passed in code', () => {
  it('are used, and win without consulting anything else', () => {
    const { cert, key } = makePair(sandbox, 'code');
    const pack = load().loadLocalCert({ cert, key });
    assert.strictEqual(pack.local, true);
    assert.match(pack.localSource, /options passed in code/);
    assert.strictEqual(pack.info.domains.commonName, '*.backloop.dev');
  });

  it('are rejected when only one of the two is given', () => {
    const { cert } = makePair(sandbox, 'half');
    assert.throws(() => load().loadLocalCert({ cert }), /must be given together/);
  });
});

describe('BACKLOOP_DEV_CERT and BACKLOOP_DEV_KEY', () => {
  it('are read from the environment', () => {
    const { cert, key } = makePair(sandbox, 'env');
    process.env.BACKLOOP_DEV_CERT = cert;
    process.env.BACKLOOP_DEV_KEY = key;
    const pack = load().loadLocalCert();
    assert.strictEqual(pack.localSource, 'BACKLOOP_DEV_CERT');
    assert.ok((pack.key1 + pack.key2).includes('PRIVATE KEY'));
  });

  it('lose to paths passed in code, which are more specific', () => {
    const env = makePair(sandbox, 'env2', '*.env.backloop.dev');
    const code = makePair(sandbox, 'code2', '*.code.backloop.dev');
    process.env.BACKLOOP_DEV_CERT = env.cert;
    process.env.BACKLOOP_DEV_KEY = env.key;
    const pack = load().loadLocalCert({ cert: code.cert, key: code.key });
    assert.strictEqual(pack.info.domains.commonName, '*.code.backloop.dev');
  });

  it('are rejected when only one of the two is set', () => {
    const { cert } = makePair(sandbox, 'envhalf');
    process.env.BACKLOOP_DEV_CERT = cert;
    assert.throws(() => load().loadLocalCert(), /must both be set/);
  });
});

describe('a config file', () => {
  it('is read from the project, with paths relative to the file itself', () => {
    makePair(path.join(sandbox, 'project', 'tls'), 'proj');
    fs.writeFileSync(path.join(sandbox, 'project', 'backloop.dev.json'),
      JSON.stringify({ cert: 'tls/proj.crt', key: 'tls/proj.key' }));
    const pack = load().loadLocalCert();
    assert.match(pack.localSource, /backloop\.dev\.json/);
    assert.strictEqual(pack.info.domains.commonName, '*.backloop.dev');
  });

  it('in HOME is used when the project has none', () => {
    const { cert, key } = makePair(path.join(sandbox, 'home'), 'home');
    fs.writeFileSync(path.join(sandbox, 'home', '.backloop.dev.json'),
      JSON.stringify({ cert, key }));
    assert.match(load().loadLocalCert().localSource, /~\/\.backloop\.dev\.json/);
  });

  it('setting only one of cert and key is an error, not a silent skip', () => {
    const { cert } = makePair(sandbox, 'cfghalf');
    fs.writeFileSync(path.join(sandbox, 'project', 'backloop.dev.json'),
      JSON.stringify({ cert }));
    assert.throws(() => load().loadLocalCert(), /must set both/);
  });
});

describe('files sitting in the certificates directory', () => {
  it('are picked up as cert.pem and key.pem', () => {
    const dir = path.join(sandbox, 'certs');
    const { cert, key } = makePair(dir, 'x');
    fs.renameSync(cert, path.join(dir, 'cert.pem'));
    fs.renameSync(key, path.join(dir, 'key.pem'));
    assert.match(load().loadLocalCert().localSource, /cert\.pem and key\.pem/);
  });

  it('are picked up in certbot naming too', () => {
    const dir = path.join(sandbox, 'certs');
    const { cert, key } = makePair(dir, 'y');
    fs.renameSync(cert, path.join(dir, 'fullchain.pem'));
    fs.renameSync(key, path.join(dir, 'privkey.pem'));
    assert.match(load().loadLocalCert().localSource, /fullchain\.pem and privkey\.pem/);
  });
});

describe('a certificate that cannot be used', () => {
  it('reports a key that belongs to a different certificate', () => {
    const a = makePair(sandbox, 'a');
    const b = makePair(sandbox, 'b');
    assert.throws(() => load().loadLocalCert({ cert: a.cert, key: b.key }), /do not match/);
  });

  it('reports a missing file instead of falling back to something else', () => {
    assert.throws(() => load().loadLocalCert({ cert: '/nope/a.crt', key: '/nope/a.key' }),
      /cannot read the certificate file/);
  });

  it('reports a file that is not PEM', () => {
    const junk = path.join(sandbox, 'junk.crt');
    fs.writeFileSync(junk, 'this is not a certificate');
    assert.throws(() => load().loadLocalCert({ cert: junk, key: junk }), /does not look like PEM/);
  });
});
