/**
 * @license
 * [BSD-3-Clause](https://github.com/perki/backloop.dev/blob/main/LICENSE)
 */

/**
 * Certificates the user already has.
 *
 * backloop.dev no longer issues anything publicly, so the common case is now a
 * developer holding a certificate from somewhere else: mkcert, a company CA,
 * Caddy, or plain openssl. This module turns a certificate and a key into the
 * pack shape the rest of the package reads, so nothing downstream has to know
 * where a certificate came from.
 *
 * Nothing here touches the network and nothing here needs a secret.
 *
 * Resolution order, first match wins:
 *
 *   1. httpsOptionsPromise({ cert, key, ca })   paths passed in code
 *   2. BACKLOOP_DEV_CERT / _KEY / _CA           environment
 *   3. backloop.dev.json, ~/.backloop.dev.json  { "cert": "...", "key": "..." }
 *   4. cert.pem + key.pem in the certs dir      or fullchain.pem + privkey.pem
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { X509Certificate, createPublicKey } = require('crypto');
const { certsPath, projectDir, readConfigObject } = require('./secret');

const PROJECT_CONFIG = 'backloop.dev.json';
const HOME_CONFIG = '.backloop.dev.json';

/**
 * Filename pairs looked for in the certificates directory, in order. The first
 * is what openssl and mkcert produce when you name the outputs yourself; the
 * second is certbot's layout, which people copy in wholesale.
 */
const PAIRS = [
  ['cert.pem', 'key.pem'],
  ['fullchain.pem', 'privkey.pem']
];

class LocalCertError extends Error {
  constructor (message) {
    super('backloop.dev: ' + message);
    this.name = 'LocalCertError';
  }
}

/**
 * A configured certificate that cannot be read is an error, never a reason to
 * quietly do something else: someone who set BACKLOOP_DEV_CERT means it, and
 * falling back would hand them a different certificate than the one they named.
 *
 * @param {string} file
 * @param {string} what - how this path was configured, for the message
 * @returns {string} PEM
 */
function readPem (file, what) {
  let pem;
  try {
    pem = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    throw new LocalCertError(`cannot read the certificate file from ${what}: ${e.message}`);
  }
  if (!/-----BEGIN /.test(pem)) {
    throw new LocalCertError(`${file} (from ${what}) does not look like PEM`);
  }
  return pem;
}

/**
 * @param {object} [options] - { cert, key, ca } as paths
 * @returns {{cert: string, key: string, ca: string|null, source: string}|null}
 */
function findSources (options = {}) {
  if (options.cert || options.key) {
    if (!options.cert || !options.key) {
      throw new LocalCertError('cert and key must be given together');
    }
    return { cert: options.cert, key: options.key, ca: options.ca || null, source: 'the options passed in code' };
  }

  const env = process.env;
  if (env.BACKLOOP_DEV_CERT || env.BACKLOOP_DEV_KEY) {
    if (!env.BACKLOOP_DEV_CERT || !env.BACKLOOP_DEV_KEY) {
      throw new LocalCertError('BACKLOOP_DEV_CERT and BACKLOOP_DEV_KEY must both be set');
    }
    return {
      cert: env.BACKLOOP_DEV_CERT,
      key: env.BACKLOOP_DEV_KEY,
      ca: env.BACKLOOP_DEV_CA || null,
      source: 'BACKLOOP_DEV_CERT'
    };
  }

  for (const [file, label] of [
    [path.join(projectDir(), PROJECT_CONFIG), './' + PROJECT_CONFIG],
    [path.join(os.homedir(), HOME_CONFIG), '~/' + HOME_CONFIG]
  ]) {
    const config = readConfigObject(file);
    if (config == null || (config.cert == null && config.key == null)) continue;
    if (config.cert == null || config.key == null) {
      throw new LocalCertError(`${label} must set both "cert" and "key"`);
    }
    // Relative paths in a config file are relative to that file, not to
    // whatever directory the process happens to have been started in.
    const base = path.dirname(file);
    return {
      cert: path.resolve(base, config.cert),
      key: path.resolve(base, config.key),
      ca: config.ca ? path.resolve(base, config.ca) : null,
      source: label
    };
  }

  for (const [certName, keyName] of PAIRS) {
    const cert = path.join(certsPath, certName);
    const key = path.join(certsPath, keyName);
    if (fs.existsSync(cert) && fs.existsSync(key)) {
      return { cert, key, ca: null, source: `${certName} and ${keyName} in ${certsPath}` };
    }
  }

  return null;
}

/**
 * Builds a pack from certificate files the user supplied.
 *
 * @param {object} [options] - { cert, key, ca } as paths
 * @returns {object|null} a pack, or null when no local certificate is configured
 * @throws {LocalCertError} when one is configured but unusable
 */
function loadLocalCert (options = {}) {
  const found = findSources(options);
  if (found == null) return null;

  const certPem = readPem(found.cert, found.source);
  const keyPem = readPem(found.key, found.source);
  const caPem = found.ca ? readPem(found.ca, found.source) : null;

  let parsed;
  try {
    parsed = new X509Certificate(certPem);
  } catch (e) {
    throw new LocalCertError(`${found.cert} is not a certificate: ${e.message}`);
  }

  // Catching the mismatch here turns an unreadable TLS handshake failure into a
  // sentence naming the two files that disagree.
  try {
    const fromCert = parsed.publicKey.export({ type: 'spki', format: 'pem' });
    const fromKey = createPublicKey(keyPem).export({ type: 'spki', format: 'pem' });
    if (fromCert !== fromKey) {
      throw new LocalCertError(`the certificate and key from ${found.source} do not match`);
    }
  } catch (e) {
    if (e instanceof LocalCertError) throw e;
    throw new LocalCertError(`cannot read the private key from ${found.source}: ${e.message}`);
  }

  const cn = s => {
    const line = s.split('\n').find(l => l.startsWith('CN='));
    return line ? line.slice(3) : '';
  };

  return {
    version: { num: '1', message: '' },
    domain: 'backloop.dev',
    local: true,
    localSource: found.source,
    cert: certPem,
    ca: caPem || certPem,
    // The rest of the package reads key1 + key2. There is no reason to split a
    // key that never leaves this machine, so it all goes in the first half.
    key1: keyPem,
    key2: '',
    info: {
      issuer: { commonName: cn(parsed.issuer) },
      domains: {
        commonName: cn(parsed.subject),
        altNames: (parsed.subjectAltName || '').split(',').map(s => s.trim().replace(/^DNS:/, '')).filter(Boolean)
      },
      notAfter: new Date(parsed.validTo).toISOString(),
      notBefore: new Date(parsed.validFrom).toISOString(),
      fingerprint256: parsed.fingerprint256
    }
  };
}

module.exports = { loadLocalCert, LocalCertError };
