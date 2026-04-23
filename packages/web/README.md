# chinmeister web

The web package contains two surfaces:

- `index.html`: the public landing page on `chinmeister.com`
- `dashboard.html` + `src/`: the authenticated React dashboard

## Install

```bash
npm install
```

This package is part of the root npm workspaces, so the root install is enough.

## Development

```bash
npm run dev:local
```

That starts the worker, provisions isolated local auth in `~/.chinmeister/local/config.json`, and starts the local dashboard on `http://localhost:56790/dashboard.html`.

If you only need the web app:

```bash
npm run dev:web
```

To point the Vite app at the local profile manually:

```bash
VITE_CHINMEISTER_PROFILE=local npm run dev:web
```

Other useful commands:

```bash
npm run build
npm run test
npm run dev:static
```
