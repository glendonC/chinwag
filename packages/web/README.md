# chinwag web

The web package contains two surfaces:

- `index.html`: the public landing page on `chinwag.dev`
- `dashboard.html` + `src/`: the authenticated React dashboard

## Install

```bash
cd packages/web
npm install
```

This package keeps its own `package-lock.json` and is installed separately from the root npm workspaces.

## Development

```bash
cd packages/web
npm run dev
```

Or from the repo root:

```bash
npm run dev:web
```

Point the dashboard at a local or staging worker:

```bash
VITE_CHINWAG_API_URL=http://localhost:8787 npm run dev
```

Other useful commands:

```bash
npm run build
npm run test
npm run dev:static
```
