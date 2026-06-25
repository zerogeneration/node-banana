/**
 * Auth preflight for the `@zerospacestudios/engine-client` dependency (the neutral
 * zerogen engine contract, published to GitHub Packages). Run `npm run check:auth`
 * before `npm install`, or as a CI pre-install step, to confirm NODE_AUTH_TOKEN is
 * set — the committed `.npmrc` consumes it via `${NODE_AUTH_TOKEN}`, and without it
 * `npm install` fails with an opaque 401/403 from npm.pkg.github.com.
 *
 * This is intentionally a standalone command, not a `preinstall` hook: npm
 * resolves and fetches dependencies before lifecycle scripts run, so a hook
 * can't fail before the registry request it would guard (verified on npm 11).
 */
if (process.env.NODE_AUTH_TOKEN && process.env.NODE_AUTH_TOKEN.trim()) {
  console.log("✔ NODE_AUTH_TOKEN is set — GitHub Packages install should authenticate.");
  process.exit(0);
}

console.error(`
✖ NODE_AUTH_TOKEN is not set.

  node-banana installs @zerospacestudios/engine-client (the zerogen engine
  contract) from GitHub Packages, which needs a read:packages token exposed as
  NODE_AUTH_TOKEN (consumed by the repo's .npmrc). It overrides any ~/.npmrc token
  for this registry, so it must be set here.

  Local dev (the gh login carries read:packages):
    export NODE_AUTH_TOKEN="$(gh auth token)"
    # first time only, if gh lacks the scope:
    #   gh auth refresh -h github.com -s read:packages
    npm install

  CI / Vercel:
    set NODE_AUTH_TOKEN to a read:packages token as a build env var.
    GitHub Actions: NODE_AUTH_TOKEN=\${{ secrets.GITHUB_TOKEN }} with
    permissions: { packages: read } (no PAT to manage).
`);
process.exit(1);
