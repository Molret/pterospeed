<div align="center">

# pterospeed

**Cut your Pterodactyl Panel build time from 5 minutes to under 90 seconds.**

[![npm version](https://img.shields.io/npm/v/pterospeed.svg)](https://www.npmjs.com/package/pterospeed)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

If you run Pterodactyl Panel, you know this feeling:

```
webpack 5 compiled successfully in 347210 ms
Done in 352.41s.
```

**pterospeed** analyzes your `webpack.config.js`, finds what is slowing your builds down, and fixes it — automatically, with a diff preview and a backup before touching anything.

## Demo

```
root@vps:/var/www/pterodactyl# npx pterospeed@latest .

pterospeed v0.1.0
✔ Detected: Pterodactyl Panel
✔ Root: /var/www/pterodactyl
✔ Config: /var/www/pterodactyl/webpack.config.js
Scanning build configuration...

⚠ Filesystem cache missing  (high)
  Current config uses memory cache. Warm builds stay slow.
⚠ babel-loader cache missing  (high)
  Babel runs cold on every build.
⚠ source-map-loader scans too wide  (medium)
  Parsing maps in node_modules can cost a lot on large panels.
⚠ parallelism missing  (medium)
  Explicit CPU parallelism can improve throughput on heavier hosts.
⚠ TerserPlugin still in production path  (medium)
  Terser is safe but slow. Aggressive preset can switch to EsbuildPlugin.

╭────────────────────────────────────────────────────────────────────────────────╮
│                                                                                │
│   pterospeed                                                                   │
│                                                                                │
│   Build Health: 46 / 100  Critical                                             │
│                                                                                │
│   ██████████████████░░░░░░░░░░░░░░░░░░░░                                       │
│                                                                                │
│   Estimated gain: warm builds ~5-10x faster; transpile cache cuts cold ~20-30% │
│                                                                                │
│   Run with --preset aggressive to also fix production minifier.               │
│                                                                                │
╰────────────────────────────────────────────────────────────────────────────────╯
```

Then:

```
root@vps:/var/www/pterodactyl# npx pterospeed optimize . --preset aggressive
```

Shows a colored diff, asks for confirmation, applies everything, and backs up your original config.

## Install

No install required — just run with npx:

```bash
npx pterospeed@latest .
```

Or install globally:

```bash
npm install -g pterospeed
# or
yarn global add pterospeed
```

## Commands

| Command | Description |
|---|---|
| `pterospeed [path]` | Analyze (default) |
| `pterospeed analyze [path]` | Scan config, report findings and score |
| `pterospeed optimize [path]` | Show diff → confirm → apply |
| `pterospeed optimize --auto` | Apply without prompting |
| `pterospeed optimize --dry` | Show diff only, write nothing |
| `pterospeed optimize --preset aggressive` | Also replace TerserPlugin with EsbuildPlugin |
| `pterospeed benchmark [path]` | Run cold/warm/production builds and measure time |
| `pterospeed revert [path]` | Restore last backup |

## What it fixes

### Safe preset (default)

Applied automatically, no breaking changes:

| Fix | Impact | Why |
|---|---|---|
| Filesystem cache | **High** | Webpack reuses work across builds. Cold → warm drops from minutes to seconds |
| babel-loader disk cache | **High** | Babel no longer re-transpiles unchanged files on each run |
| source-map-loader scoping | **Medium** | Stops parsing source maps inside `node_modules` |
| Explicit parallelism | **Medium** | Uses all available CPU cores instead of webpack's default |

### Aggressive preset (`--preset aggressive`)

Everything in safe, plus:

| Fix | Impact | Why |
|---|---|---|
| EsbuildPlugin instead of TerserPlugin | **Medium** | esbuild minifies ~3-4x faster than Terser in production. Output is equivalent |

> **Note:** The aggressive preset adds `esbuild-loader` to your `devDependencies`. Run `yarn install` (or `npm install`) in your panel after optimizing.

## How it works

pterospeed parses your `webpack.config.js` as an AST using [recast](https://github.com/benjamn/recast) + [@babel/parser](https://babeljs.io/docs/babel-parser). It makes surgical edits directly on the syntax tree, preserving your original formatting and comments. No string replacement, no regex hacks.

Before writing anything, it saves a timestamped backup to `.pterospeed/backups/`. You can always run `pterospeed revert` to undo.

## Requirements

- Node.js >= 20
- A project with `webpack.config.js` (Pterodactyl Panel, Pelican, or any webpack 5 project)

## Roadmap

- [ ] v0.2 — Pelican Panel support
- [ ] v0.3 — esbuild-loader for TypeScript transpilation (replaces babel-loader entirely)
- [ ] v0.4 — Thread-loader for parallelizing babel
- [ ] v1.0 — General webpack optimizer for any project

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

Built by a Pterodactyl host owner who got tired of 5-minute builds.

**[⭐ Star on GitHub](https://github.com/Molret/pterospeed) if this saved you time.**

</div>
