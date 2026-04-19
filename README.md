# pterospeed

> Cut your Pterodactyl Panel build time from **5 minutes to under 90 seconds** — no manual webpack knowledge required.

[![npm](https://img.shields.io/npm/v/pterospeed)](https://www.npmjs.com/package/pterospeed)
[![license](https://img.shields.io/github/license/Molret/pterospeed)](LICENSE)

---

## The problem

Every Pterodactyl dev knows this:

```
webpack 5 compiled successfully in 347210 ms
Done in 352.41s.
```

The default webpack config that ships with Pterodactyl Panel is unoptimized. No filesystem cache, no transpile cache, slow production minifier, no CPU parallelism. Every build starts cold and pays the full cost.

**pterospeed** finds those issues and fixes them — automatically, with a diff preview and a backup before touching anything.

---

## Usage

```bash
# Run directly, no install needed
npx pterospeed@latest .

# Or install globally
npm i -g pterospeed
```

---

## Commands

```bash
pterospeed [path]                               # analyze (default)
pterospeed analyze [path]                       # scan config and report score
pterospeed optimize [path]                      # diff → confirm → apply
pterospeed optimize [path] --auto               # skip confirmation
pterospeed optimize [path] --dry                # diff only, write nothing
pterospeed optimize [path] --preset aggressive  # also swap TerserPlugin → esbuild
pterospeed benchmark [path]                     # measure cold / warm / production builds
pterospeed revert [path]                        # restore last backup
```

---

## What it fixes

### Safe preset (default)

| Optimization | Expected gain |
|---|---|
| Webpack filesystem cache | Warm builds **5–10x faster** — skips full cold parse |
| babel-loader disk cache | Cold builds **~20–30% faster** — no re-transpile of unchanged files |
| Scope source-map-loader | Skips parsing maps inside `node_modules` |
| Explicit CPU parallelism | Full core utilization on multi-core hosts |

### Aggressive preset (`--preset aggressive`)

Everything in safe, plus:

| Optimization | Expected gain |
|---|---|
| EsbuildPlugin instead of TerserPlugin | Production minification **~3–4x faster** |

> After aggressive optimization, run `yarn install` (or `npm install`) in your panel to install `esbuild-loader`.

---

## How it works

pterospeed reads your `webpack.config.js` as an AST using [recast](https://github.com/benjamn/recast). It makes surgical edits on the syntax tree — no string replacement, no regex. Your formatting and comments stay intact.

Before writing anything, it saves a timestamped backup to `.pterospeed/backups/`. Run `pterospeed revert` at any time to undo.

---

## Requirements

- Node.js 20+
- A project with `webpack.config.js` (Pterodactyl Panel, Pelican, or any webpack 5 project)

---

## Roadmap

- [ ] `v0.2` — Pelican Panel support
- [ ] `v0.3` — swap babel-loader for esbuild-loader entirely (aggressive)
- [ ] `v0.4` — thread-loader support
- [ ] `v0.5` — `pterospeed migrate-vite`: full webpack → Vite migration with blade template patching, backup, and dry-run
- [ ] `v1.0` — general webpack optimizer, any project

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT © [Molret](https://github.com/Molret)

---

**[⭐ Star this repo](https://github.com/Molret/pterospeed) if it saved you time.**
