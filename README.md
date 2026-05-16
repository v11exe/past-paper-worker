# Past Paper Worker

A Vite + React app for uploading past papers, extracting structured questions, taking attempts, and marking answers with Claude Sonnet through a secure Cloudflare Worker proxy. Gemini remains available as a fallback and Dev mode option.

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

AI actions do require a backend proxy. The browser never receives Anthropic or Gemini API keys directly.

Feedback submissions also go through the Worker so the Resend API key stays server-side.

## Install

```bash
npm install
```

## Run locally

Start the frontend:

```bash
npm run dev
```

For AI features in local development, point the frontend at the secure AI proxy route with `.env.local`:

```bash
VITE_AI_PROXY_URL=http://127.0.0.1:8788/api/ai
```

Use `.env.local.example` as the template. `VITE_GEMINI_PROXY_URL` is still accepted as a backwards-compatible fallback.

The feedback form does not need any frontend secret or extra Vite environment variable.

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
npm run smoke:ai
```

## AI provider configuration

Frontend-safe config belongs in `.env.local`:

```bash
VITE_AI_PROXY_URL=http://127.0.0.1:8788/api/ai
```

Server-side secret belongs in Cloudflare Worker secrets only:

```bash
ANTHROPIC_API_KEY=PASTE_ROTATED_ANTHROPIC_KEY_HERE
# Optional Gemini fallback:
GEMINI_API_KEY=PASTE_ROTATED_GEMINI_KEY_HERE
RESEND_API_KEY=PASTE_RESEND_API_KEY_HERE
```

Use `.dev.vars.example` as the local template for worker secrets.

Optional Worker runtime settings for feedback email delivery:

```bash
FEEDBACK_TO_EMAIL=feedback@omair.uk
FEEDBACK_FROM_EMAIL=Revision Feedback <feedback@omair.uk>
```

## Cloudflare Worker deployment

This project is set up for a Cloudflare Worker with static assets and a secure AI proxy route.

- Build command: `npm run build`
- Wrangler deploy command: `npm run deploy`

Set these Worker runtime secrets/settings in Cloudflare:

- required: `ANTHROPIC_API_KEY`
- required: `RESEND_API_KEY`
- optional: `GEMINI_API_KEY`
- optional: `FEEDBACK_TO_EMAIL`
- optional: `FEEDBACK_FROM_EMAIL`

Useful commands:

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GEMINI_API_KEY
```

The frontend calls `/api/ai` by default in production, so the key stays server-side.
The in-app feedback form posts to `/api/feedback`, and the Worker forwards it to Resend without exposing any mail secret to the browser.

## Notes

- The Vite base is relative (`./`) so static assets can be served from a root domain or subpath.
- AI features will not work on a purely static host unless it also provides the `/api/ai` secure AI proxy.
- The app itself does not set cookies. If you add third-party analytics later, handle consent separately.
