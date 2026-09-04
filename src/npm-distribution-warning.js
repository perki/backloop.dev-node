/**
 * @license
 * [BSD-3-Clause](https://github.com/perki/backloop.dev/blob/main/LICENSE)
 */

/**
 * Present only on the `npm` branch, which is what gets published to the
 * registry. `main` does not carry it, so a copy installed from git stays quiet
 * — which is the whole point: seeing this means the project you are in has not
 * moved off npm yet.
 *
 * This file must remain the *only* difference between the two branches. Put
 * nothing here that main would also want, and change nothing else on this
 * branch, or a rebase starts to conflict and the published build drifts from
 * the tag it claims.
 */
function show () {
  console.log('');
  console.log('  ⚠️  backloop.dev will not be updated on npm anymore, and is');
  console.log('     reserved for private usage.');
  console.log('     Read https://backloop.dev for more details.');
  console.log('');
  console.log('     If you are part of the private team, change your package.json:');
  console.log('');
  console.log('       "backloop.dev": "git+https://github.com/perki/backloop.dev-node.git"');
  console.log('');
}

module.exports = { show };
