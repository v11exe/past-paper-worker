# Past Paper Worker

A Vite + React app for uploading past papers, extracting structured questions, taking attempts, and marking answers with Gemini through a secure Cloudflare Worker proxy.

## What it does

- Upload a question paper and optional mark scheme.
- Extract structured questions, marks, numbering, and supported answer formats.
- Run timed attempts in focus mode.
- Mark answered questions against the uploaded mark scheme.
- Export diagnostics when processing or marking goes wrong.

## Storage and privacy

This app stores papers, attempts, metadata, diagnostics, and reduced thumbnails in the current browser's `localStorage`.

- There is no database.
- There is no app backend for user data.
- Each browser profile keeps its own local data.
- Full-size screenshots are stripped before persistence to reduce storage pressure.

AI actions do require a backend proxy for Gemini. The browser never receives the Gemini API key directly.

## Install

```bash
npm install
```

## Run locally

Start the frontend:

```bash
npm run dev
```

For AI features in local development, point the frontend at a Gemini proxy route with `.env.local`:

```bash
VITE_GEMINI_PROXY_URL=http://127.0.0.1:8788/api/ai
```

Use `.env.local.example` as the template.

## Build

```bash
npm run build
```

The production build is written to `dist/`.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run e2e
npm run smoke:gemini
```

## Gemini configuration

Frontend-safe config belongs in `.env.local`:

```bash
VITE_GEMINI_PROXY_URL=http://127.0.0.1:8788/api/ai
```

Server-side secret belongs in Cloudflare Worker secrets only:

```bash
GEMINI_API_KEY=PASTE_ROTATED_GEMINI_KEY_HERE
```

Use `.dev.vars.example` as the local template for worker secrets.

## Cloudflare Worker deployment

This project is set up for a Cloudflare Worker with static assets and a secure Gemini proxy route.

- Build command: `npm run build`
- Wrangler deploy command: `npm run deploy`

Set the `GEMINI_API_KEY` secret in Cloudflare for the Worker runtime.

The frontend calls `/api/ai` by default in production, so the key stays server-side.

## Notes

- The Vite base is relative (`./`) so static assets can be served from a root domain or subpath.
- AI features will not work on a purely static host unless it also provides the `/api/ai` Gemini proxy.
- The app itself does not set cookies. If you add third-party analytics later, handle consent separately.
