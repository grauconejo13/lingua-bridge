# Deployment

Lingua Bridge has two parts:

- **Frontend** (`apps/web`): static files. Any static host works, including Vercel.
- **API** (`apps/server`): a long-running Node process. It holds WebSocket connections and keeps conversations and presentations in memory, so it needs a host that runs a server continuously (Render, Railway, Fly.io, a VPS). It cannot run as serverless functions.

The simplest production setup is still one process serving both (`npm run build && npm start`). The steps below are for hosting them separately.

## Frontend on Vercel

The repo root has a `vercel.json` that builds only the web app, so no settings need changing.

1. In the Vercel dashboard, choose **Add New → Project** and import `grauconejo13/lingua-bridge`.
2. Leave **Root Directory** as the repository root, because the web app depends on the shared workspace package.
3. Under **Environment Variables**, add `VITE_API_URL` with the API's address, for example `https://lingua-bridge-api.onrender.com`, with no trailing slash. It is read at build time, so redeploy after changing it.
4. Deploy. Vercel builds the production branch (`main`) and gives every other branch a preview URL.

Without `VITE_API_URL` the site still loads, and its status banner says it isn't connected to a translation server.

## API on a Node host

```bash
npm ci
npm run build -w @lingua-bridge/server
npm start                      # node apps/server/dist/index.js
```

Environment variables:

| Variable      | Value                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `HOST`        | `0.0.0.0` (most hosts require it)                                                                             |
| `PORT`        | Usually provided by the host                                                                                  |
| `CORS_ORIGIN` | The frontend's origin, e.g. `https://lingua-bridge.vercel.app` (comma-separate several, such as preview URLs) |
| `PROVIDER`    | `mock` for the demo, or `openai` with `OPENAI_API_KEY`                                                        |

Run **one instance**: rooms and talks live in that process's memory. Free tiers that sleep when idle end every conversation and presentation when they sleep, and the first request after waking is slow.

## Phones

Microphones only work over HTTPS. Both Vercel and the usual Node hosts provide HTTPS, so phones can use the deployed app directly; WebSockets connect to `wss://` on the API's host automatically.
