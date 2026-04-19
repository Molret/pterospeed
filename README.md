# pterospeed

CLI para analizar y optimizar builds de Pterodactyl Panel.

## Comandos

```bash
npm install
npm run build

node dist/index.js analyze ./example-panel
node dist/index.js optimize ./example-panel --dry
node dist/index.js optimize ./example-panel --auto
node dist/index.js optimize ./example-panel --dry --preset aggressive
node dist/index.js benchmark /ruta/al/panel
node dist/index.js revert /ruta/al/panel
```

## Safe preset

- `cache: filesystem`
- `babel-loader` cache
- `source-map-loader` excluye `node_modules`
- `parallelism` por CPU

## Aggressive preset

- Todo lo de `safe`
- Reemplaza `TerserPlugin` por `EsbuildPlugin`
- Agrega `esbuild-loader` a `devDependencies`

## Notas

- `optimize` muestra diff. Sin `--auto`, pide confirmación antes de escribir.
- `benchmark` usa scripts reales del proyecto.
- `revert` restaura último backup guardado en `.pterospeed/backups`.
