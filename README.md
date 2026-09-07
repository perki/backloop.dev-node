# backloop.dev

[![npm](https://img.shields.io/npm/v/backloop.dev)](https://www.npmjs.com/package/backloop.dev) [![License](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)

Do SSL HTTPS requests on **Localhost** using a domain and SSL certificates pointing to your local environment.

**https://\<any subdomain>.backloop.dev/ → https://localhost/**

Any subdomain of `*.backloop.dev` points to `localhost`!

--------------------------------------------------

> ## No longer a public service
>
> Until 2026-09-04 this package downloaded a browser-trusted wildcard certificate that
> <https://backloop.dev> published openly. That is over. A public certificate authority
> is obliged to revoke any certificate whose private key is published — CA/Browser Forum
> Baseline Requirements §4.9.1.1 — and both authorities did: Let's Encrypt within about
> nine hours, then Sectigo within about two days. <https://backloop.dev> tells the whole
> story.
>
> **The package still works, and it still works for you.** What no longer exists is a
> certificate that browsers trust with nothing installed. There are three ways to get one
> now, and the first two need no secret:
>
> 1. [**Bring your own certificate**](#bringing-your-own-certificate), from
>    [mkcert](https://github.com/FiloSottile/mkcert), Caddy, your company CA or plain
>    openssl. Nothing is downloaded, nobody else holds the key, and this is the right
>    answer whenever you can manage it.
> 2. [**Use the public certificate**](#the-public-certificate), which is shared,
>    self-signed, and installed once per machine from
>    <https://backloop.dev/public/>. No toolchain required.
> 3. **A secret**, for the private setup this project became. **Access is not open** and
>    there is no way to request one.

## Why it exists

**backloop.dev** solves [mixed-content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content) issues when developing a WebApp or Backend on local environment while accessing resources on remote HTTPS sources.

The issue is often raised by the [same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy) mechanism that restricts the loading of resources from another origin unless this can be allowed by sending correct [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) headers.

Which anyway will fall back on the must-have "non-mixed-content" (no HTTP & HTTPS).

But making requests to **HTTPS APIs** from **HTTP** sites on **localhost** would not be possible without changing security options on your browser, which is why **backloop.dev** provides SSL certificates with a full loopback domain, to let anyone benefit from a signed certificate on **localhost**.

## Installation

```
npm install backloop.dev [-g]
```

Versions below 4.0.0 are deprecated: they belong to the public-service era and npm warns
anyone still installing them. 4.0.0 carries no warning — it is the version that works.

Add `-g`, or use `npx`, for the `backloop.dev`, `backloop.dev-proxy` and
`backloop.dev-update` commands.

## Where are the certificates?

Certificates are not bundled with the package. `BACKLOOP_DEV_CERTS_DIR` chooses where
they are stored; the directory must already exist.

The first of these that applies wins:

| | Source | Needs |
|---|---|---|
| 1 | A certificate you supplied ([below](#bringing-your-own-certificate)) | nothing |
| 2 | A pack already in the certificates directory | nothing |
| 3 | A download from the secret path | a secret |
| 4 | The [public certificate](#the-public-certificate) | nothing |

Downloads happen at installation (postinstall) and at runtime when close to expiry, or
manually with `backloop.dev-update`. A certificate you supplied is never downloaded over
and never refreshed: it is yours, and replacing it is your business.

A configured secret that fails is an error and never falls back to the public
certificate. Silently serving something other than what you asked for would send you
debugging the wrong thing.

`https://backloop.dev/pack.json` does still answer, but only with the last public
certificate — revoked on 2026-07-31, expiring 2026-10-29, never renewed. It is left
there so that installs of version 3 and earlier fail slowly rather than on a 404. Do not
build anything on it.

### Configuring the secret

Provide it in any one of these ways. The first one that is set wins:

| | How |
|---|---|
| 1 | `httpsOptionsPromise({ secret })` or `httpsOptionsAsync({ secret }, done)` — in code |
| 2 | `BACKLOOPDEV=<secret>` — environment variable, works in CI and at postinstall |
| 3 | `./backloop.dev.json` in your project root — `{ "secret": "<secret>" }` |
| 4 | `~/.backloop.dev.json` — one secret for every local project |
| 5 | typed at the prompt, then remembered in `node_modules/backloop.dev/certs/secret` |

The environment variable is the one worth setting properly. Add it to `~/.zshrc` or
`~/.bashrc` and open a new terminal:

```bash
export BACKLOOPDEV=<secret>
```

(`BACKLOOP_DEV_SECRET` is also read, after `BACKLOOPDEV`.)

A secret is 8 to 128 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`. A malformed one is
reported rather than skipped, because it is far likelier to be a typo than an
invitation to fall back to the next source.

**Never commit a secret.** Add `backloop.dev.json` to your `.gitignore`; a secret in a
public repository, a CI log or a pasted stack trace is a secret that is gone.

### Being asked for it

When nothing above is configured, an asynchronous start-up asks once:

```
The secret for backloop.dev is unknown. If you know it, enter it now.
Otherwise, or to learn how to set it as an environment variable, press enter.
Secret:
```

A secret that successfully downloads the pack is proven, so it is written to
`certs/secret` inside the installed package and you are never asked again. One that
does not work is not saved, and you get a note telling you to ask whoever administers
your setup. Pressing enter prints the configuration instructions above.

You will only ever see this prompt when a person is actually there: it requires both
stdin and stdout to be a terminal. In CI, under a process supervisor, or during
`npm install` — where npm pipes a script's output elsewhere and a question would be an
invisible hang — nothing is asked. Pass `interactive: false` to turn it off in a service
that starts unattended.

Without a secret, installation still succeeds. The postinstall step prints a notice
explaining what to do — but npm hides lifecycle output unless a script fails, so in
practice you will not see it (`npm install --foreground-scripts` shows it). The moment
you actually find out is the first start, where you get the prompt above or, if nothing
is watching, a clear error. That is deliberate: a missing certificate can be fixed later,
a broken `npm install` cannot.

### Bringing your own certificate

Any certificate and key in PEM will do. The package reads them, checks that they belong
together, and never touches the network:

```bash
export BACKLOOP_DEV_CERT=/path/to/cert.pem
export BACKLOOP_DEV_KEY=/path/to/key.pem
export BACKLOOP_DEV_CA=/path/to/chain.pem   # optional
```

Four ways to configure it, first match wins:

| | How |
|---|---|
| 1 | `httpsOptionsPromise({ cert, key, ca })`, paths, for programmatic use |
| 2 | `BACKLOOP_DEV_CERT`, `BACKLOOP_DEV_KEY`, `BACKLOOP_DEV_CA` |
| 3 | `backloop.dev.json` in the project, or `~/.backloop.dev.json`, as `{ "cert": "...", "key": "..." }`. Relative paths are resolved against the file itself, not the working directory |
| 4 | `cert.pem` + `key.pem`, or `fullchain.pem` + `privkey.pem`, sitting in `BACKLOOP_DEV_CERTS_DIR` |

With [mkcert](https://github.com/FiloSottile/mkcert), which issues from a local authority
that only your machine trusts:

```bash
mkcert -install
mkcert '*.backloop.dev' backloop.dev
export BACKLOOP_DEV_CERT=$PWD/_wildcard.backloop.dev+1.pem
export BACKLOOP_DEV_KEY=$PWD/_wildcard.backloop.dev+1-key.pem
```

Setting only one of cert and key is an error rather than a silent skip, and so is a key
that does not match its certificate. Both are reported by name, because the alternative
is a TLS handshake failing somewhere far from the cause.

### The public certificate

With no secret and no certificate of your own, the package downloads the shared
self-signed certificate from <https://backloop.dev/public/> and says so at start-up.

It is self-signed, so nothing can revoke it, which is exactly why it exists. It is also
shared, and its private key is published with it, so **your browser rejects it until you
install it once on your machine**. <https://backloop.dev/public/> has the instructions
for macOS, Windows and Linux, and is honest about what installing it means.

It is a leaf certificate and deliberately not a certificate authority, so it can never be
used to sign any hostname other than `*.backloop.dev`.

Firefox does not use the system trust store and will not accept it, so bring your own
certificate if Firefox is your development browser.

### Skipping the download entirely

If you already hold the certificate files, point `BACKLOOP_DEV_CERTS_DIR` at a
directory containing a valid `pack.json` and no secret is needed at all. This is also
how to install in an offline or sandboxed environment:

```bash
npm install --ignore-scripts backloop.dev
export BACKLOOP_DEV_CERTS_DIR=/path/to/certs
```

## Command line

(Don't forget to prefix commands with `npx` if not installed globally.)

### Static file server

Serve the contents of a directory on `https://whatever.backloop.dev:<port>/`:

```
backloop.dev <path> [<port>]
```

Example:
```bash
backloop.dev ./dist 4443
# Server started on port 4443 serving files in './dist'
# Open https://myapp.backloop.dev:4443/
```

### Reverse proxy

Proxy requests from `https://whatever.backloop.dev:<port>/` to a backend.
Supports `http://` and `https://` targets, with optional base path.
Note: adds `x-forwarded-proto: https` to headers for express-session and similar services.

```
backloop.dev-proxy <target> [<port>]
```

Where `<target>` can be:
- `http://host[:port][/path]`
- `https://host[:port][/path]`
- `host[:port]` (legacy format, defaults to http)

Examples:
```bash
# Proxy to a local dev server
backloop.dev-proxy localhost:3000

# Proxy to an https backend with a base path
backloop.dev-proxy https://localhost:8443/api 4443
```

### Multi-host config mode

Serve multiple hostnames from a single instance, each with its own static files or proxy target:

```
backloop.dev --config=<config.json>
```

Config file format:
```json
{
  "port": 7654,
  "hostnames": {
    "app": { "path": "./dist" },
    "api": { "proxy": "http://localhost:3000/v1" },
    "admin": { "proxy": "https://anotherwebsite.com:8443" }
  }
}
```

This starts a single server on port 7654 where:
- `https://app.backloop.dev:7654/` serves static files from `./dist`
- `https://api.backloop.dev:7654/` proxies to `http://localhost:3000/v1`
- `https://admin.backloop.dev:7654/` proxies to `https://anotherwebsite.com:8443`

Paths are resolved relative to the config file location.

**Path-based routing** is also supported. Use `hostname/path/` keys (trailing slash required) to route different URL prefixes to different handlers on the same hostname:

```json
{
  "port": 7654,
  "hostnames": {
    "tom/static/": { "path": "./public" },
    "tom/": { "proxy": "http://localhost:3000" }
  }
}
```

Here `https://tom.backloop.dev:7654/static/app.js` serves `./public/app.js`, while `https://tom.backloop.dev:7654/api/users` proxies to `http://localhost:3000/api/users`. The longest matching prefix wins.

### Certificate update

Manually force update of the certificates:

```
backloop.dev-update
```

Unlike the postinstall step, this fails loudly when there is no secret or the download
does not work — you asked for it deliberately, so a silent success would be a lie.

## From a node app

### ES6 Module

```js
import { httpsOptionsPromise } from 'backloop.dev';
import https from 'https';

const httpsOptions = await httpsOptionsPromise();

https.createServer(httpsOptions, (req, res) => {
  res.writeHead(200);
  res.end('hello world\n');
}).listen(8443);
```

Before version 5 the default export *was* the resolved options, so importing the module
fetched the certificate. That made it unusable from a config file — Node refuses
`require()` on a graph containing a top-level await — and made a production build
download a certificate it had no use for. Importing now does nothing until you call
something. Code written for version 4 fails with an explanation rather than starting a
server with no certificate.

### CommonJS

```js
const https = require('https');
const httpsOptionsAsync = require('backloop.dev').httpsOptionsAsync;

httpsOptionsAsync(function (err, httpsOptions) {
  https.createServer(httpsOptions, (req, res) => {
    res.writeHead(200);
    res.end('hello world\n');
  }).listen(8443);
});
```

Or with promises:

```js
const https = require('https');
const httpsOptionsPromise = require('backloop.dev').httpsOptionsPromise;

(async () => {

  const httpsOptions = await httpsOptionsPromise();
  https.createServer(httpsOptions, (req, res) => {
    res.writeHead(200);
    res.end('hello world\n');
  }).listen(8443);

})();
```

Both take an optional options object to pass the secret directly, overriding every
configured source:

```js
const httpsOptions = await httpsOptionsPromise({ secret: process.env.MY_OWN_VAR });

httpsOptionsAsync({ secret: process.env.MY_OWN_VAR }, function (err, httpsOptions) { /* ... */ });
```

The following is not recommended as it will crash your app if the certificates are expired. It will however refresh them for your next boot ;).

```js
const https = require('https');
const options = require('backloop.dev').httpsOptions();

https.createServer(options, (req, res) => {
  res.writeHead(200);
  res.end('hello world\n');
}).listen(8443);
```

### Express

```js
const https = require('https');
const httpsOptionsAsync = require('backloop.dev').httpsOptionsAsync;
const express = require('express');
const app = express();

// ...your code...

httpsOptionsAsync(function (err, httpsOptions) {
  https.createServer(httpsOptions, app).listen(8443);
});
```

### VueJs

```js
// consider  `await require('backloop.dev').httpsOptionsPromise()`
const backloopHttpsOptions = require('backloop.dev').httpsOptions();
backloopHttpsOptions.https = true;
backloopHttpsOptions.host = 'whatever.backloop.dev';

module.exports = {
  // ...your options...
  devServer: backloopHttpsOptions
};
```

Now `vue-cli-service serve` will be served on `https://whatever.backloop.dev`

### ViteJs

File: `vite.config.js`

```js
import { defineConfig } from 'vite';
import { httpsOptionsPromise } from 'backloop.dev';

export default defineConfig(async () => ({
  server: {
    port: 4443,
    host: 'whatever.backloop.dev',
    https: await httpsOptionsPromise()
  },
  // ... //
}));
```

Note the async config factory: resolving the certificate at the top level of
`vite.config.js` would put a top-level await in a graph Vite loads with `require()`,
which Node refuses.

Now `npm run dev` will be served on `https://whatever.backloop.dev`
There is also a ViteJS plugin that does the same: [vite-plugin-backloop.dev](https://github.com/perki/backloop.dev-vite).

## Notices

`pack.json` may carry a `notice`, which the package prints once at start-up:

```
  ┌ backloop.dev
  │ The secret changes on 15 January 2027.
  │ Ask for the new one before then, or downloads will start failing.
  └
```

That is the only way whoever publishes the certificate can tell you something — most
likely that the secret is about to rotate. It is informational: nothing fails, nothing
exits, and it disappears on its own once the date it announced has passed.

## Security

What if `*.backloop.dev` DNS A and AAAA entries are not pointing to `127.0.0.1` and `::1` but to another IP (malicious ones)?
Then your HTTPS requests will not end up on your machine, but on these malicious servers.

Even if this is very unlikely to happen, you may want to be on the safe side by adding `<what you need>.backloop.dev` in your `/etc/hosts` file.

```
127.0.0.1 localhost whatever.backloop.dev ...
::1 localhost whatever.backloop.dev ...
```

Note also that the secret only keeps the certificate from being *discovered*. It does
not make the certificate private: everyone holding a secret holds the same key, and a
certificate authority that learns of it must still revoke. Expect rotation, and expect
the certificate to be replaced without notice.

## Testing

```
npm test
```

Uses Node.js built-in test runner (requires Node.js 18+).

## Contributing

`npm run lint` lints the code with [neostandard](https://github.com/neostandard/neostandard).

Pull requests are welcome.

The code that used to generate, publish and renew the certificates is
[in `renew/`](https://github.com/perki/backloop.dev/tree/main/renew). It can no longer
complete: Let's Encrypt has blocklisted the domain.

## License

[BSD-3-Clause](https://github.com/perki/backloop.dev/blob/main/LICENSE)
