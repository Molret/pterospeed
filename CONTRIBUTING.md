# Contributing

## Setup

```bash
git clone https://github.com/Molret/pterospeed.git
cd pterospeed
npm install
npm run build
```

## Development

```bash
npm run dev -- analyze ./your-panel-path
npm run dev -- optimize ./your-panel-path --dry
```

`npm run dev` uses `tsx` to run TypeScript directly — no build step needed while iterating.

## Testing changes

The `example-panel/` directory contains a real Pterodactyl webpack.config.js for local testing:

```bash
npm run dev -- analyze example-panel
npm run dev -- optimize example-panel --dry --preset aggressive
```

## Adding an optimization

1. Add a `check*` function in `src/analyze.ts` — returns a `Finding`
2. Add an `ensure*` function that applies the fix via AST manipulation
3. Register both in `analyzeProject()` and `optimizeProject()`
4. Add a gain description in `computeEstimatedGain()` and `buildGainSummary()`
5. Add the new `FindingId` to `src/types.ts`

## Project structure

```
src/
  analyze.ts   — core: AST parsing, finding checks, optimization logic
  index.ts     — CLI commands and user interaction
  project.ts   — project detection and path helpers
  types.ts     — TypeScript interfaces
  ui.ts        — terminal output formatting
```

## Pull Requests

- Keep PRs focused — one optimization or fix per PR
- Test against a real Pterodactyl/Pelican panel if possible
- Run `npm run check` before submitting (type check without emitting)
