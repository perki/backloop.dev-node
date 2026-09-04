/**
 * @license
 * [BSD-3-Clause](https://github.com/perki/backloop.dev/blob/main/LICENSE)
 */

/**
 * A one-way channel from whoever publishes the certificate to whoever installed
 * the package — to announce a secret rotation with a date, say.
 *
 * It is deliberately not `pack.json`'s `version.message`, which only prints when
 * the pack format is newer than the package can read and which then kills the
 * process. Announcing something must never be a reason to stop someone's dev
 * server, so nothing here throws, exits, or writes to stderr.
 */

/**
 * Accepts either shape, because this field is written by hand:
 *
 *   "notice": "The secret changes on 2027-01-15."
 *   "notice": { "message": "…", "until": "2027-01-15T00:00:00Z" }
 *
 * @param {object} pack - a parsed pack.json
 * @param {number} [now] - milliseconds, for tests
 * @returns {string|null} the message to show, or null when there is nothing to say
 */
function readNotice (pack, now = Date.now()) {
  const notice = pack?.notice;
  if (notice == null) return null;

  const message = typeof notice === 'string' ? notice : notice.message;
  if (typeof message !== 'string' || message.trim() === '') return null;

  // A pack stays on disk until the certificate nears expiry, so a notice can
  // easily outlive the date it was announcing. An expired one goes quiet rather
  // than nagging about something that already happened.
  if (typeof notice === 'object' && notice.until != null) {
    const until = new Date(notice.until).getTime();
    if (!Number.isNaN(until) && until < now) return null;
  }

  return message.trim();
}

/**
 * A build published to npm carries an extra module saying so; the repository
 * does not, and neither does a copy installed from git. Its absence is the
 * normal case, which is why this resolves to null instead of throwing.
 *
 * Keeping the hook here and the text in a file of its own means the npm branch
 * only ever *adds* a file — it can be rebased onto main forever without a
 * conflict, and the two cannot drift apart.
 */
function loadDistributionWarning () {
  try {
    return require('./npm-distribution-warning');
  } catch (e) {
    return null;
  }
}

/**
 * One distribution warning per process, whichever package gets there first.
 *
 * A Vite project loads two of these — the plugin and this package — and both
 * would otherwise say the same thing back to back, sixteen lines of it, when
 * the plugin's message already names both dependencies to change. The flag is a
 * well-known symbol rather than an environment variable so it neither pollutes
 * the environment nor silences child processes that have their own story.
 */
const WARNED = Symbol.for('backloop.dev.distributionWarningShown');

/**
 * Says, once, whatever the published build wants said about how it was
 * obtained. Nothing at all when the module is absent, and nothing when
 * something else has already spoken.
 */
function showDistributionWarning () {
  if (globalThis[WARNED]) return;
  const mod = loadDistributionWarning();
  if (mod == null || typeof mod.show !== 'function') return;
  globalThis[WARNED] = true;
  try {
    mod.show();
  } catch (e) {
    // Saying something must never be a reason to stop a dev server.
  }
}

// Showing the same thing twice in one process is noise; showing a *different*
// one — the freshly downloaded pack superseding the cached copy — is not.
let lastShown = null;

/**
 * @param {object} pack - a parsed pack.json
 */
function showNotice (pack) {
  let message;
  try {
    message = readNotice(pack);
  } catch (e) {
    return; // a malformed notice is never worth disturbing anyone over
  }
  if (message == null || message === lastShown) return;
  lastShown = message;

  console.log('');
  console.log('  ┌ backloop.dev');
  for (const line of message.split('\n')) console.log('  │ ' + line);
  console.log('  └');
  console.log('');
}

/** Tests need to forget what has already been shown. */
function resetNotice () {
  lastShown = null;
  delete globalThis[WARNED];
}

module.exports = { readNotice, showNotice, showDistributionWarning, resetNotice, WARNED };
