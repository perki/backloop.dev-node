/**
 * @license
 * [BSD-3-Clause](https://github.com/perki/backloop.dev/blob/main/LICENSE)
 */

/**
 * Until version 5 this module awaited the certificate at the top level and
 * exported the result, so `import httpsOptions from 'backloop.dev'` fetched
 * over the network merely by being imported.
 *
 * That was a trap. A production build that needs no certificate downloaded one;
 * a `vite.config.js` importing it could not be loaded at all, because Node
 * refuses `require()` on a graph containing a top-level await
 * (ERR_REQUIRE_ASYNC_MODULE); and there was no way to say "not now".
 *
 * So this exports the functions, like the CommonJS entry does, and nothing
 * happens until one is called.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const backloopDev = require('./index.js');

export const httpsOptions = backloopDev.httpsOptions;
export const httpsOptionsAsync = backloopDev.httpsOptionsAsync;
export const httpsOptionsPromise = backloopDev.httpsOptionsPromise;

const api = { httpsOptions, httpsOptionsAsync, httpsOptionsPromise };

// Code written for version 4 passes this object straight to https.createServer,
// which would otherwise start a server with no certificate and fail somewhere
// far from the cause. Reading any of the three fields it looks for says what
// happened instead.
const MIGRATION = `backloop.dev 5 no longer resolves the certificate when the module is imported.

  Before:  import httpsOptions from 'backloop.dev'
  Now:     import { httpsOptionsPromise } from 'backloop.dev'
           const httpsOptions = await httpsOptionsPromise()

Importing no longer performs a network request, which is what makes the package
usable from a config file and from a production build.`;

for (const field of ['key', 'cert', 'ca']) {
  Object.defineProperty(api, field, {
    get () { throw new Error(MIGRATION); },
    enumerable: false,
    configurable: true
  });
}

export default api;
