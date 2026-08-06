# AGENTS.md — backloop.dev (npm package)

Quick reference for AI agents using or modifying this package.

## What it does

HTTPS on localhost without self-signed certificates:

- Any subdomain of `*.backloop.dev` resolves to `127.0.0.1` / `::1` (public DNS).
- This package downloads a publicly shared, publicly trusted wildcard certificate for `*.backloop.dev` and exposes it as ready-to-use `{ key, cert, ca }` options for `https.createServer()`.

So `https://anything.backloop.dev:<port>/` reaches your local server with a valid certificate — no browser warnings, no mixed-content/CORS friction.

## API (CommonJS and ESM)

```js
import httpsOptions from 'backloop.dev';                  // ESM default: sync, see caveat below
const { httpsOptions, httpsOptionsAsync, httpsOptionsPromise } = require('backloop.dev');
```

- `httpsOptionsPromise(): Promise<{key, cert, ca}>` — **preferred**; refreshes the certificate if needed.
- `httpsOptionsAsync(cb)` — callback flavor of the same.
- `httpsOptions(): {key, cert, ca}` — sync; if the certificate is missing/expired it triggers an update and **exits the process** (works on next start). Avoid in long-running tooling.

Types are in `src/index.d.ts`.

## CLI (npx or global install)

```bash
backloop.dev <path> [<port>]              # static file server on https://<any>.backloop.dev:<port>/
backloop.dev-proxy <target> [<port>]      # reverse proxy to http(s)://host[:port][/path]
backloop.dev --config=<config.json>       # multi-host: route hostnames/paths to static dirs or proxies
backloop.dev-update                       # force certificate refresh
```

Multi-host config format (paths resolved relative to the config file):

```json
{
  "port": 7654,
  "hostnames": {
    "app": { "path": "./dist" },
    "api": { "proxy": "http://localhost:3000/v1" },
    "tom/static/": { "path": "./public" }
  }
}
```

Keys with a trailing `/` are path prefixes on a hostname; longest prefix wins.

## Certificates: where and when

- Certificates are **not bundled**. `postinstall` and the runtime fetch them from `https://backloop.dev/pack.json` (also browsable on https://backloop.dev).
- Stored in `<package>/certs/` by default; override with the env var `BACKLOOP_DEV_CERTS_DIR` (the directory must exist).
- The private key comes split in two parts (`key1` + `key2` in `pack.json`); the package concatenates them. This is intentional — the certificate is public by design and only secures loopback traffic.
- **Offline/sandboxed environments**: `npm install` fails without network because of the postinstall script. Use `npm install --ignore-scripts` and pre-seed `BACKLOOP_DEV_CERTS_DIR` with a valid `pack.json`.
- Trust note: if you want to guard against DNS tampering, add `<name>.backloop.dev` to `/etc/hosts` pointing to `127.0.0.1`.

## Developing this package

```bash
npm install
npm test        # Node.js built-in test runner, Node 18+
npm run lint    # eslint + neostandard
```

Layout: `src/index.js|mjs|d.ts` (API), `src/check.js` (download/refresh logic), `src/webserver/` (CLI server, proxy, multi-host config), `bin/` (CLI entry points), `test/`.

See the [repository AGENTS.md](https://github.com/perki/backloop.dev/blob/main/AGENTS.md) for monorepo-wide conventions. Full documentation: [README.md](./README.md).
