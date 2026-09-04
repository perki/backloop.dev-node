# Changelog

## 4.1.0

- **`pack.json` can now carry a `notice`**, shown once at start-up. It is how whoever
  publishes the certificate tells whoever installed the package something — that the
  secret rotates on a given date, most likely. Either shape works, since the field is
  edited by hand:

  ```json
  "notice": "The secret changes on 2027-01-15."
  "notice": { "message": "…", "until": "2027-01-20T00:00:00.000Z" }
  ```

  Past `until`, it goes quiet: a pack sits on disk until the certificate nears expiry, so
  without that a notice would nag for months about a date already gone. An unparseable
  `until` shows the message anyway — a typo in a date must not silence an announcement.

  This is deliberately **not** `version.message`, which only prints when the pack format
  is newer than the package can read and which then calls `process.exit(1)`. Announcing
  something must never be a reason to stop someone's dev server, so nothing in this path
  throws or exits.

  Older versions ignore the field, so publishing one is safe — but they also cannot show
  it. A notice only reaches installations on 4.1.0 or later.

## 4.0.0

**Breaking: a secret is now required to download the certificate.**

backloop.dev stopped being a public service on 2026-09-04. The certificate is no longer
published at a public URL, because a public certificate authority must revoke any
certificate whose private key is published (CA/Browser Forum Baseline Requirements
§4.9.1.1) — Let's Encrypt did so in about nine hours and blocklisted the domain, Sectigo
in about two days. https://backloop.dev carries the full account.

- The certificate pack is fetched from a path segment that requires a secret. Resolved,
  first match wins, from `httpsOptionsPromise({ secret })`, `BACKLOOPDEV`,
  `BACKLOOP_DEV_SECRET`, `./backloop.dev.json`, `~/.backloop.dev.json`, then a secret
  remembered in `certs/secret`. A secret is 8 to 128 characters of `A-Z a-z 0-9 _ -`; a
  malformed one is reported rather than skipped.
- **The secret can be typed at the prompt.** When nothing is configured and a person is
  at the terminal, asynchronous start-up asks once. An answer that downloads a pack is
  proven, so it is saved to `certs/secret` (mode 0600) and never asked for again; one
  that does not is not saved, and prints a note to ask whoever administers the setup.
  Asking requires stdin and stdout to both be TTYs and is never done during postinstall,
  so CI and `npm install` cannot hang on it. `interactive: false` turns it off.
- `httpsOptionsPromise()` and `httpsOptionsAsync()` take an optional `{ secret }` first
  argument. `httpsOptionsAsync(callback)` is unchanged. `httpsOptions()` is unchanged and
  cannot carry a secret.
- **`postinstall` no longer fails the install.** It ran without a `catch`, so since
  Node 15 any fetch failure aborted `npm install` outright; with a secret now required
  that would break every install that has not configured one. It prints how to configure
  a secret and exits 0. A deliberate `backloop.dev-update` still exits 1 on failure.
- A wrong or rotated secret produces a clear message instead of a JSON parse error.
- `BACKLOOP_DEV_CERTS_DIR` is unchanged and still bypasses the download entirely — point
  it at a directory holding a valid `pack.json` and no secret is needed.
- New: `src/secret.js`, the single place that knows how the secret is resolved and how
  the download URL is built, with `test/secret.test.js` covering it.

Access is not open, and there is no way to request a secret. For HTTPS on localhost use
a local certificate authority: mkcert, Caddy's internal CA, or vite-plugin-mkcert.

## 3.0.3
- Added `AGENTS.md` (guidance for AI coding agents), shipped with the package
- Added `files` field to package.json: tarball no longer includes `test/`, `eslint.config.js` and the example `config.json`

## 3.1.0

### New features
- **Multi-host config mode**: Serve multiple hostnames from a single instance using `backloop.dev --config=<file>`. Each hostname can independently serve static files or proxy to a backend.
- **HTTPS proxy support**: Proxy can now target `https://` backends in addition to `http://`.
- **Proxy path support**: Proxy targets can include a base path (e.g. `http://localhost:3000/api`), which is prepended to all proxied requests.

### Changes
- `backloop.dev-proxy` now accepts full URL format: `backloop.dev-proxy https://host:port/path [port]` (legacy `host:port` format still supported).
- Refactored static server and proxy into reusable handler factories (`createStaticHandler`, `createProxyHandler`).
- Added test suite using Node.js built-in test runner (24 tests).

### Config file format
```json
{
  "port": 6667,
  "hostnames": {
    "app": { "path": "./dist" },
    "api": { "proxy": "http://localhost:3000/v1" },
    "secure": { "proxy": "https://backend:8443" }
  }
}
```

## 3.0.1
- Package version update

## 3.0.0
- Removed Express dependency
- Pure Node.js HTTPS server and proxy
- Added TypeScript definitions
- Added ES Module support
