# Changelog

All notable changes to pterospeed will be documented here.

## [0.1.0] - 2025-04-18

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
