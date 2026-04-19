# Changelog

All notable changes to pterospeed will be documented here.

## [0.3.0] - 2026-04-18

### Added
- `pterospeed audit [url]` — run Google PageSpeed Insights against your live panel
- Auto-detect panel URL from `.env` `APP_URL` (no argument needed if run from panel root)
- `--strategy mobile|desktop|both` support
- `--key <apiKey>` or `PAGESPEED_KEY` env var for PageSpeed API key
- Color-coded Lighthouse score bars for Performance, Accessibility, Best Practices, SEO
- Filtered audit issue list (only items scoring < 90)
- Shareable report URL with base64url-encoded data (`pterospeed.me/r/[id]?d=...`)

## [0.2.0] - 2026-04-17

### Added
- esbuild-loader for TypeScript/TSX transpilation (10-20x faster than babel-loader)
- Webpack version detection — flags webpack 4 as high-impact non-fixable
- `always-minimize` detection — warns when `minimize: true` unconditionally runs in dev
- `esbuild-transpile` finding — high-impact suggestion to replace babel-loader
- Webpack 4 `cache: true` recognized as valid (not flagged as missing filesystem cache)
- ConditionalExpression traversal for cache and minimizer detection (fixes false positives/negatives on real panels)
- Dead `require('terser-webpack-plugin')` removal after minifier replacement
- Post-optimize gain summary with share URL and GitHub star CTA

## [0.1.0] - 2026-04-16

### Added
- `pterospeed analyze [path]` — scan webpack.config.js and report build health score (0–100)
- `pterospeed optimize [path]` — apply optimizations with diff preview and confirmation prompt
- `pterospeed optimize --auto` — apply without prompting
- `pterospeed optimize --dry` — show diff only, write nothing
- `pterospeed optimize --preset aggressive` — also replace TerserPlugin with EsbuildPlugin
- `pterospeed benchmark [path]` — run cold/warm/production builds and report timing
- `pterospeed revert [path]` — restore last backup from `.pterospeed/backups/`
- Safe preset: filesystem cache, babel-loader disk cache, source-map-loader scoping, explicit parallelism
- Aggressive preset: all safe fixes + EsbuildPlugin as production minimizer
- AST-based config patching via recast — preserves code formatting, no fragile string replace
- Automatic backup before any write
- Color-coded diff output
- Build health score box with progress bar
- Specific gain estimates per optimization (e.g. "~3-4x faster production minification")
- Post-optimize summary box with GitHub star CTA
- Pterodactyl Panel detection via package.json name, composer.json, and file structure
