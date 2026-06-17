/**
 * Preinstall guard: fail fast (with the fix) when the GitHub Packages token
 * needed to install the private `@zerospacestudios/providers` dependency is
 * missing. The root `.npmrc` reads `${NODE_AUTH_TOKEN}`; without it, `npm install`
 * dies with an opaque 401 from npm.pkg.github.com. Catching it here turns that
 * into an actionable message.
 *
 * Set SKIP_REGISTRY_AUTH_CHECK=1 to bypass (e.g. if you authenticate the
 * @zerospacestudios scope some other way, such as a user-level ~/.npmrc).
 */
if (process.env.SKIP_REGISTRY_AUTH_CHECK) process.exit(0);
if (process.env.NODE_AUTH_TOKEN && process.env.NODE_AUTH_TOKEN.trim()) process.exit(0);

console.error(`
✖ NODE_AUTH_TOKEN is not set.

  node-banana installs the private package @zerospacestudios/providers from
  GitHub Packages, which needs a read:packages token exposed as NODE_AUTH_TOKEN
  (consumed by the repo's .npmrc).

  Local dev (the gh login carries read:packages):
    export NODE_AUTH_TOKEN="$(gh auth token)"
    # first time only, if gh lacks the scope:
    #   gh auth refresh -h github.com -s read:packages
    npm install

  CI / Vercel:
    set NODE_AUTH_TOKEN to a read:packages token as a build env var.
    GitHub Actions: NODE_AUTH_TOKEN=\${{ secrets.GITHUB_TOKEN }} with
    permissions: { packages: read } (no PAT to manage).

  (Set SKIP_REGISTRY_AUTH_CHECK=1 to bypass if you authenticate another way.)
`);
process.exit(1);
