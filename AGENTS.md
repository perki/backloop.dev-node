# AGENTS.md — backloop.dev (npm package)

Quick reference for AI agents using or modifying this package.

## Read this first

backloop.dev is **no longer a public service**. Until 2026-09-04 it downloaded a freely
published, browser-trusted wildcard certificate; that model is dead, because a public
certificate authority must revoke any certificate whose private key is published
(CA/Browser Forum Baseline Requirements §4.9.1.1) and both authorities did — Let's
Encrypt in about nine hours, Sectigo in about two days. https://backloop.dev now carries
the full account.

Consequences for anything you do here:

- Still published on npm. Everything below 4.0.0 is deprecated — that is what a stranger
  installing `backloop.dev` lands on, and the message explains the shutdown. 4.0.0 is not
  deprecated: it is the working version and a warning on every install would be noise.
- `https://backloop.dev/pack.json` still responds, deliberately, but it serves the last
  public certificate — revoked 2026-07-31, expiring 2026-10-29. It is frozen there so
  that v3 installs keep working: v3's postinstall has no `catch`, so a 404 there aborts
  the whole `npm install`. Never treat it as current, and never describe it as a 404.
  The five individual certificate files beside it *are* gone (404). The live pack lives
  behind a path segment that requires a secret.
- **Access to the secret is not open.** If a user does not have one, do not look for a
  way to obtain one, because there isn't one. Point them at the two routes that need no
  secret instead: a certificate of their own (`BACKLOOP_DEV_CERT` and `BACKLOOP_DEV_KEY`,
  from [mkcert](https://github.com/FiloSottile/mkcert),
  [Caddy](https://caddyserver.com/docs/automatic-https#local-https) or openssl), or the
  public self-signed certificate the package now falls back to. Both are described under
  "Where a certificate comes from" below.
- **Never write a secret into this repository.** It is public. No default value, no test
  fixture, no CI variable, no example in a README. `backloop.dev.json` and
  `.backloop.dev.json` are gitignored; keep it that way.

## What it does

- Any subdomain of `*.backloop.dev` resolves to `127.0.0.1` / `::1` (public DNS, still live).
- This package downloads a wildcard certificate for `*.backloop.dev` and exposes it as
  ready-to-use `{ key, cert, ca }` options for `https.createServer()`.

So `https://anything.backloop.dev:<port>/` reaches your local server with a valid
certificate — no browser warnings, no mixed-content/CORS friction.

## API (CommonJS and ESM)

```js
import { httpsOptionsPromise } from 'backloop.dev';       // ESM, since 5.0.0
const { httpsOptions, httpsOptionsAsync, httpsOptionsPromise } = require('backloop.dev');
```

**Importing resolves nothing.** Before 5.0.0 the ESM entry awaited the certificate at the
top level and exported the result, so the module fetched over the network merely by being
imported — which made a production build download a certificate it had no use for, and
made the module unloadable from a `vite.config.js`, since Node refuses `require()` on a
graph containing a top-level await. Keep `src/index.mjs` free of top-level `await`.

Reading `key`, `cert` or `ca` on the default export throws a migration message: that is
exactly what version 4 code did when it handed the default export to
`https.createServer`, and an explanation beats a server started with no certificate.

- `httpsOptionsPromise(options?): Promise<{key, cert, ca}>` — **preferred**; refreshes the certificate if needed.
- `httpsOptionsAsync(options?, cb)` — callback flavor of the same; `httpsOptionsAsync(cb)` still works.
- `httpsOptions(): {key, cert, ca}` — sync; if the certificate is missing/expired it triggers an update and **exits the process** (works on next start). Avoid in long-running tooling. Takes no options, so it cannot carry a secret — use one of the other sources.

`options` is `{ secret, interactive, cert, key, ca }`. `secret` overrides every configured
source; `cert` and `key` are paths and override everything including the secret, since a
certificate that is already on disk needs no download. Types are in `src/index.d.ts`.

## The secret

`src/secret.js` is the only place that knows how the secret is found and how the URL is
built. Resolution order, first match wins:

1. `{ secret }` passed to the API
2. `BACKLOOPDEV`
3. `BACKLOOP_DEV_SECRET` (the earlier name, still read)
4. `./backloop.dev.json` (`{ "secret": "..." }`, resolved against `INIT_CWD` or `cwd`)
5. `~/.backloop.dev.json`
6. `<certsPath>/secret`, written by the prompt below

Validated against `/^[A-Za-z0-9_-]{8,128}$/` before it can reach a URL, so a malformed
value cannot escape its path segment. A malformed secret throws `InvalidSecretError`
rather than falling through to the next source — it is far likelier to be a typo than an
invitation to fall back. No secret at all throws `MissingSecretError`, whose message
explains every way to configure one.

When none of those has a secret, `updateAndLoad` may ask at the terminal — once, not in
a loop. An answer that downloads a pack is proven, so it is saved to `<certsPath>/secret`
(mode 0600) and never asked for again; one that does not is not saved and prints
`ASK_THE_ADMIN`. An empty answer falls back to the public certificate.

**Asking is off by default and guarded twice**, because a prompt nobody can see is a
hang: `interactive` must be passed, *and* `canPrompt()` requires stdin and stdout to both
be TTYs. `httpsOptionsPromise` / `httpsOptionsAsync` pass `interactive: true`; the sync
`httpsOptions()` and `bin/update.js --postinstall` pass false. Do not turn it on for the
postinstall hook — npm pipes lifecycle output elsewhere, so the question would never be
seen and `npm install` would hang.

`BACKLOOP_DEV_CERTS_DIR` pointed at a directory that already holds a valid `pack.json`
skips the download entirely, and needs no secret. This is the offline/sandboxed path.

## Where a certificate comes from

Four sources, tried in this order by `updateAndLoad`. Only one of them needs a secret,
which is the whole point: the package is useful to a stranger again.

| | Source | Module |
|---|---|---|
| 1 | A certificate the user supplied | `src/localcert.js` |
| 2 | A pack already cached for the current source | `src/check.js` |
| 3 | A download from the secret path | `src/check.js` |
| 4 | The public self-signed certificate | `src/check.js` |

### The cache is split by source

`certsPath/public/` and `certsPath/private/` hold downloaded packs; `certsPath/pack.json`
is a pack the user supplied and is read but never written.

They were one shared `pack.json` until 5.2.0, and that was a bug: after running with no
secret, configuring one changed nothing, because the cached public pack was still
unexpired and was returned before anything asked which source the configuration now
pointed at. `currentSource()` decides the directory, so the two can no longer be confused
and neither can overwrite the other.

The one judgement call is `readSuppliedPack()`. A top-level `pack.json` is either a pack
the user placed on purpose, which must keep working offline, or a cache left by 5.1.0 or
earlier. They are indistinguishable, so the rule is the one that cannot serve the wrong
certificate: a `public` pack there is ignored once a secret is configured, and everything
else is honoured.

**A configured secret that fails must never fall back.** Only `MissingSecretError`, which
means nothing is configured anywhere, reaches `fetchPublicPack()`. A malformed secret or a
404 from a wrong one is an error and stays an error. Quietly substituting a different
certificate would send someone debugging their own code instead of their configuration,
and it would undo the reason `bin/update.js` reports a failed install rather than
announcing success.

### Bring your own certificate

`src/localcert.js` turns a certificate and key into the pack shape, so nothing downstream
has to know where a certificate came from. It never touches the network. Resolution order:
`{ cert, key, ca }` passed to the API, then `BACKLOOP_DEV_CERT` / `_KEY` / `_CA`, then
`"cert"` and `"key"` in `backloop.dev.json` or `~/.backloop.dev.json` (paths resolved
against the config file, not `cwd`), then `cert.pem` + `key.pem` or `fullchain.pem` +
`privkey.pem` in `certsPath`.

Half a configuration is an error, not a silent skip, and so is a key that does not match
its certificate. Both name the files involved: the alternative is a TLS handshake failing
somewhere far from the cause. A local pack carries `local: true` and `localSource`, and
`key1` holds the whole key with `key2` empty, since there is no reason to split a key that
never leaves the machine.

### The public certificate

Shared, self-signed, published at `https://backloop.dev/public/` with its private key,
built by `tools/build-public-pack.js` in the hub repository. No certificate authority
issued it, so no authority can be obliged to revoke it, which is exactly what killed the
old public service.

It is a **leaf**, `CA:FALSE`, `serverAuth` only. Never publish a root: a root whose key is
public would let anyone holding that key mint a certificate for *any* hostname for every
person who installed it. As a leaf the worst case is impersonating `*.backloop.dev`
origins, which already resolve to loopback. The generating tool refuses to write anything
else, and that refusal must stay.

The pack carries `public: true`, which is what `showPublicWarning()` keys off. The warning
appears once per process and links to the install page, because a user who has not
installed it will meet a browser warning and otherwise have no idea why.

Measured on macOS 26 on 2026-09-07: a user-installed self-signed leaf is trusted by Safari
and Chrome, **and Apple's 825-day ceiling does not apply to it** (a 3650-day certificate
verifies and loads clean). Firefox uses its own store, will not accept a non-CA as an
authority, and is a documented limitation rather than something to work around.

## The npm branch

`main` is what the repository is. The `npm` branch is `main` plus exactly one file,
`src/npm-distribution-warning.js`, and it is what gets published to the registry — so a
copy installed from npm says it is no longer updated there, and a copy installed from
git says nothing.

`src/notice.js` loads that module optionally and ignores its absence, which is why the
branch never has to touch a file `main` also touches. **Keep it that way.**

Only one warning is shown per process: whichever package speaks first sets
`Symbol.for('backloop.dev.distributionWarningShown')` on `globalThis`, and the other
falls silent. That is a contract with `vite-plugin-backloop.dev`, which loads this
package and would otherwise double the message — change the symbol name in one and you
must change it in both. The moment
the branch edits shared code it can conflict, and two versions of the same release start
to diverge.

The published tarball therefore differs from the tag of the same name by that one file.
A `-npm` tag makes that explicit rather than leaving it to be discovered, so the artifact
on the registry always has a git ref that describes it exactly:

```bash
git checkout npm && git rebase main     # must never conflict
npm test && npm run lint                # the suite runs on both branches
git tag -f v<version>-npm && git push -f origin npm --tags
npm publish
git checkout main
```

## Notices

`src/notice.js` reads an optional `notice` field from `pack.json` and prints it once per
process at start-up. It is the only channel from the certificate publisher to installed
copies — a secret rotation with a date, in practice.

- Accepts `"notice": "text"` or `{ message, until }`; `until` in the past means silence.
- Never throws, never exits, never writes to stderr. **Keep it that way.** Announcing
  something must not be a reason to stop someone's dev server.
- It is not `pack.json`'s `version.message`, which fires only when `version.num` exceeds
  the package's hardcoded `versionNum` and then calls `process.exit(1)`. That one is an
  incompatibility signal, not a message channel — do not repurpose it.
- Shown from `updateAndLoad` (cached and freshly downloaded packs) and from the sync
  `httpsOptions()`. A second, *different* notice in the same process does print; the same
  one twice does not.
- Only installations on 4.1.0 or later can show it. Older ones ignore the field safely,
  but publishing a notice does not reach them.

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

The proxy and every `"proxy"` route share `createProxyHandler` in `src/webserver/proxy.js`.
Its callbacks run on a later tick than the handler, where nothing catches, so a throw
there stops the process and every host it serves (issue #1, fixed in 5.2.1). Every
callback goes through `guarded()`, and nothing writes to the response without checking it
is still open. **Keep it that way.** There is no upstream timeout; do not add a `timeout`
listener without also setting one.

## Certificates: where and when

- Certificates are **not bundled**. `postinstall` and the runtime fetch them from the
  secret path; stored in `<package>/certs/` by default, override with
  `BACKLOOP_DEV_CERTS_DIR` (the directory must exist — `src/check.js` exits the process
  if it does not).
- **`postinstall` never fails the install.** `bin/update.js --postinstall` prints a
  notice and exits 0 when there is no secret or the download fails. A deliberate
  `backloop.dev-update` exits 1 on the same failure. Keep that asymmetry.
- That postinstall notice is effectively invisible: npm only surfaces lifecycle output
  when a script fails, so it takes `--foreground-scripts` to see it. Do not rely on it to
  tell anyone anything — the prompt and the runtime error are what people actually meet.
- The private key comes split in two parts (`key1` + `key2` in `pack.json`); the package
  concatenates them. The split delays naive scanners and nothing more — it is not a
  security measure and should not be described as one.
- Trust note: if you want to guard against DNS tampering, add `<name>.backloop.dev` to
  `/etc/hosts` pointing to `127.0.0.1`.

## Developing this package

```bash
npm install
npm test        # Node.js built-in test runner, Node 18+
npm run lint    # eslint + neostandard
```

Layout: `src/index.js|mjs|d.ts` (API), `src/secret.js` (secret resolution and URL),
`src/check.js` (download/refresh logic), `src/webserver/` (CLI server, proxy, multi-host
config), `bin/` (CLI entry points), `test/`.

Full documentation: [README.md](./README.md). The website, the renewal code and the
project-wide rules — about the secret, and about what the public site may say — live in
the repository this package was split out of,
[perki/backloop.dev](https://github.com/perki/backloop.dev/blob/main/AGENTS.md).

## Developing

Development happens from [perki/backloop.dev](https://github.com/perki/backloop.dev),
which is the hub for the whole project. Its `tools/setup.sh` clones this repository into
`packages/`, installs it, and links the two packages against each other so a change in
one is testable from the other without publishing. Working directly in a standalone
clone is fine too; the hub only saves the wiring.
