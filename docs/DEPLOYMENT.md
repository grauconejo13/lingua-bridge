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

### Cost controls (set these before using a real API key)

| Variable           | Default              | What it does                                                                                                                                                                                                                                |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DAILY_BUDGET_USD` | `5`                  | Estimated spend per UTC day. When reached, translation stops with a friendly message until midnight UTC. `0` means no cap.                                                                                                                  |
| `USAGE_FILE`       | unset                | Path to a small JSON file (date, spend, pause switch) so a restart can't reset the budget. Use a persistent disk if your host has one.                                                                                                      |
| `ADMIN_TOKEN`      | unset                | Turns on `/admin`, a phone-friendly page with today's spend, live counts, provider latency and a **Pause translation** switch. At least 24 characters; generate one with `openssl rand -base64 32`.                                         |
| `PRICE_*`          | OpenAI launch prices | Used only for estimates: `PRICE_TRANSCRIBE_PER_MINUTE` (0.003), `PRICE_TRANSLATE_INPUT_PER_MILLION_TOKENS` (0.15), `PRICE_TRANSLATE_OUTPUT_PER_MILLION_TOKENS` (0.60), `PRICE_TTS_PER_1K_CHARS` (0.017, about $0.015 per minute of speech). |

The spend shown is an estimate from these prices, not your bill; check the provider's dashboard for real charges, and set a hard limit there too. Every feature (translator, conversations, presentations, read-aloud) goes through the same meter, so the cap can't be bypassed by switching screens. The demo provider is never charged.

Run **one instance**: rooms and talks live in that process's memory. Free tiers that sleep when idle end every conversation and presentation when they sleep, and the first request after waking is slow.

## Phones

Microphones only work over HTTPS. Both Vercel and the usual Node hosts provide HTTPS, so phones can use the deployed app directly; WebSockets connect to `wss://` on the API's host automatically.
