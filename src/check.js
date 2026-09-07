/**
 * @license
 * [BSD-3-Clause](https://github.com/perki/backloop.dev/blob/main/LICENSE)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  resolveSecret, packUrl, publicPackUrl, certsPath, savedSecretPath, canPrompt, promptForSecret,
  saveSecret, SECRET_PATTERN, MissingSecretError, ASK_THE_ADMIN
} = require('./secret');
const { showNotice, showDistributionWarning, showPublicWarning, showLocalCertNotice } = require('./notice');
const { loadLocalCert } = require('./localcert');

const versionNum = 1;

if (!fs.existsSync(certsPath)) {
  if (process.env.BACKLOOP_DEV_CERTS_DIR) {
    console.error(`Error! env var BACKLOOP_DEV_CERTS_DIR is defined with value: [${process.env.BACKLOOP_DEV_CERTS_DIR}] but directory does not exists`);
  } else {
    console.error(`Error! directory ${certsPath} does not exists`);
  }
  process.exit(1);
}

/**
 * A pack the user put there themselves. It is read but never written, which is
 * the documented offline path: point BACKLOOP_DEV_CERTS_DIR at a directory
 * holding a valid pack.json and nothing is downloaded.
 */
const suppliedPackPath = path.resolve(certsPath, 'pack.json');

/**
 * Downloaded packs are cached per source, never in one shared file.
 *
 * Sharing one pack.json meant that configuring a secret after running on the
 * public certificate kept serving the public one: the cache was still valid, so
 * nothing looked wrong and nothing went and fetched the certificate the user
 * had just been given access to. Keeping them apart makes that structurally
 * impossible, and means neither can overwrite the other.
 *
 * @param {'public'|'private'} source
 */
function cacheDir (source) {
  return path.resolve(certsPath, source);
}

/**
 * Which certificate the current configuration asks for. An explicit secret or
 * any configured one means the private path; nothing configured means the
 * public certificate. A malformed secret is neither: it is a mistake, and it
 * propagates so the user is told rather than quietly served something else.
 *
 * @param {string} [explicit]
 * @returns {'public'|'private'}
 */
function currentSource (explicit) {
  try {
    resolveSecret(explicit);
    return 'private';
  } catch (err) {
    if (err instanceof MissingSecretError) return 'public';
    throw err;
  }
}

/**
 * @param {boolean} [force] - download even when the local certificate is still valid
 * @param {object} [options]
 * @param {string} [options.secret] - overrides every configured source
 * @param {boolean} [options.interactive] - may ask for the secret at the terminal
 *   when none is configured. Off by default, because a prompt nobody can see is
 *   a hang: only callers that know a person is waiting should turn it on.
 */
async function updateAndLoad (force = false, { secret, interactive = false, cert, key, ca } = {}) {
  // A certificate the user supplied wins over everything: it needs no network,
  // no secret, and no cache, and choosing anything else would silently serve
  // something other than the file they named.
  const local = loadLocalCert({ cert, key, ca });
  if (local != null) {
    showDistributionWarning();
    showLocalCertNotice(local);
    local.expirationDays = expirationDays(local.info.notAfter);
    if (local.expirationDays < 0) {
      console.log(`backloop.dev: the certificate from ${local.localSource} expired ${-local.expirationDays} days ago`);
    }
    return local;
  }

  const source = currentSource(secret);
  const actual = loadFromLocalDirectory(' Auto updating ', source);

  if (actual?.version?.num != null) {
    if (actual.version.num > versionNum) {
      console.error('Current package version is not compatible with certification file format.\nUpdate backloop.dev to latest version.\n' + actual.version.message);
      process.exit(1);
    }
  }

  if (!force) {
    if (actual != null && actual.expirationDays > 0) {
      showDistributionWarning();
      showPublicWarning(actual);
      showNotice(actual);
      return actual;
    }
  } else {
    console.log('Force update of backloop.dev certificate');
  }

  const res = await fetchPackWithSecret(secret, interactive);

  const expDays = expirationDays(res.info.notAfter);
  if (expDays < 0) {
    console.log('Downloaded backloop.dev certificate expired -- open an issue on https://github.com/perki/backloop.dev');
    return actual;
  }

  const dir = cacheDir(source);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.resolve(dir, 'backloop.dev-bundle.crt'), res.cert + '\n' + res.ca);
  fs.writeFileSync(path.resolve(dir, 'backloop.dev-ca.crt'), res.ca);
  fs.writeFileSync(path.resolve(dir, 'backloop.dev-cert.crt'), res.cert);
  fs.writeFileSync(path.resolve(dir, 'README.md'), 'concatenate keys file in backloop.dev-key.pem to use');
  fs.writeFileSync(path.resolve(dir, 'backloop.dev-key.part1.pem'), res.key1);
  fs.writeFileSync(path.resolve(dir, 'backloop.dev-key.part2.pem'), res.key2);
  fs.writeFileSync(path.resolve(dir, 'pack.json'), JSON.stringify(res, null, 2));

  showDistributionWarning();
  showPublicWarning(res);
  showNotice(res);
  console.log('Updated backloop.dev certificate, expires in ' + expDays + ' days');
  console.log(`Using ${certsPath} to store certificates files.`);
  res.expirationDays = expDays;
  return res;
}

/**
 * Uses a configured secret when there is one. When there is not and a person is
 * watching, asks them once: a secret that downloads a pack is proven, so it is
 * remembered and never asked for again. A secret that does not is not worth a
 * retry loop — the answer is to go and get the right one.
 *
 * @param {string} [explicit] - secret passed by the caller
 * @param {boolean} interactive - whether asking is allowed
 * @returns Promise<CertsPack>
 */
async function fetchPackWithSecret (explicit, interactive) {
  try {
    return await fetchPack(resolveSecret(explicit));
  } catch (err) {
    // Only a *missing* secret is worth asking about, and only a missing one is
    // worth falling back for. A configured secret that is malformed or wrong is
    // a problem to report: quietly handing back a different certificate would
    // send someone debugging their own code instead of their configuration.
    if (!(err instanceof MissingSecretError)) throw err;
    if (!interactive || !canPrompt()) return await fetchPublicPack();
  }

  const answer = await promptForSecret();
  if (answer === '') return await fetchPublicPack();

  if (!SECRET_PATTERN.test(answer)) {
    console.log('\n' + ASK_THE_ADMIN + '\n');
    throw new MissingSecretError();
  }

  let res;
  try {
    res = await fetchPack(answer);
  } catch (err) {
    console.log('\n' + ASK_THE_ADMIN + '\n');
    throw err;
  }

  saveSecret(answer);
  console.log(`Secret accepted and remembered in ${savedSecretPath}`);
  return res;
}

/**
 * The certificate for everyone who has no secret: shared, self-signed, and
 * useless until installed, which is what the warning at start-up is for.
 *
 * @returns Promise<CertsPack>
 */
function fetchPublicPack () {
  return get(publicPackUrl(), 'the public certificate');
}

/**
 * @param {string} secret - validated secret, the path segment the pack lives under
 * @returns Promise<CertsPack>
 */
function fetchPack (secret) {
  // The secret is a path segment, so a wrong one reads as a plain 404.
  return get(packUrl(secret), 'the certificate pack',
    'Certificate pack not found (HTTP 404). The secret is wrong, or it has been rotated.');
}

/**
 * @param {string} url
 * @param {string} what - named in the error, so a failure says which fetch failed
 * @param {string} [notFound] - message for a 404, when there is a better one
 * @returns Promise<CertsPack>
 */
function get (url, what, notFound) {
  return new Promise((resolve, reject) => {
    https.get(url, function (res) {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(res.statusCode === 404 && notFound
          ? notFound
          : `Unexpected HTTP ${res.statusCode} while downloading ${what}.`));
      }
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try {
          return resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid response ' + data));
        }
      });
    }).on('error', reject);
  });
}

function loadFromLocalDirectory (msgOnNeedUpdate, source = currentSource()) {
  const found = readPackFrom(path.resolve(cacheDir(source), 'pack.json')) ??
                readSuppliedPack(source);
  if (found == null) {
    console.log('backloop.dev certificate not present. ' + msgOnNeedUpdate);
    return null;
  }
  const actual = found;
  actual.expirationDays = expirationDays(actual.info.notAfter);
  if (actual.expirationDays < 0) {
    console.log('backloop.dev certificate expired since ' + (-1 * actual.expirationDays) + ' days. ' + msgOnNeedUpdate);
  } else {
    console.log('backloop.dev certificate OK, expires in ' + actual.expirationDays + ' days');
  }
  return actual;
}

/**
 * @param {string} file
 * @returns {object|null} the parsed pack, or null when it is absent or unreadable
 */
function readPackFrom (file) {
  if (!fs.existsSync(file)) return null;
  try {
    const pack = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return pack?.info?.notAfter != null ? pack : null;
  } catch (e) {
    console.error(`backloop.dev: ignoring ${file}: ${e.message}`);
    return null;
  }
}

/**
 * The pack sitting directly in the certificates directory.
 *
 * Two different things end up there. One is a pack the user placed on purpose,
 * which is the documented way to run offline and must keep working. The other
 * is a cache written by an older version of this package, before caches were
 * split per source. They are indistinguishable on disk, so the only safe rule
 * is the one that cannot serve the wrong certificate: a public pack is ignored
 * once a secret is configured, since a user who has just been given a secret
 * means to use it. Everything else is honoured.
 *
 * @param {'public'|'private'} source
 * @returns {object|null}
 */
function readSuppliedPack (source) {
  const pack = readPackFrom(suppliedPackPath);
  if (pack == null) return null;
  if (pack.public === true && source === 'private') {
    console.log('backloop.dev: a secret is configured, so the public certificate in ' +
      `${certsPath} is being replaced`);
    return null;
  }
  return pack;
}

/**
 * @returns {number} - in days when the certificate expires (if negative it's expired)
 */
function expirationDays (stringDate) {
  const expireMs = new Date(stringDate).getTime() - Date.now();
  return Math.trunc(expireMs / (1000 * 60 * 60 * 24));
}

module.exports = {
  updateAndLoad,
  loadFromLocalDirectory
};
