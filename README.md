# Past Paper Worker

A standalone React/Vite app for uploading past papers, extracting structured questions, taking attempts, and marking answered questions with Puter.js AI calls from the browser.

## What Works Locally

- Upload PDFs or images for the question paper and optional mark scheme.
- Extract question metadata, source pages, marks, and answer formats.
- Take a paper in focus mode with normal skips or confidence skips.
- AI-mark answered questions using the uploaded mark scheme.
- Save papers and attempts in the browser with `localStorage`.

## Privacy And Storage

This app does not set cookies. It stores papers, attempts, metadata, diagnostics, and reduced page thumbnails in the current browser's `localStorage` so each browser profile keeps its own data. Full page screenshots are stripped before persistence to reduce storage pressure.

Uploaded files and extracted text stay in the browser unless you run an AI action through Puter.js. AI processing and marking send the relevant prompts and attached page images to Puter.js from the frontend.

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5177`.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

The production build is written to `dist/`.

## Checks Before Pushing

```bash
npm run lint
npm test
npm run build
npm run e2e
```

## Static Hosting

The app is built with a relative Vite base (`./`), so the `dist` folder can be hosted at a domain root or a subpath. It needs a static host that serves `index.html`, `assets/*`, `logo.svg`, and `puter-test.html`.

For GitHub Pages, build with `npm run build` and publish the `dist/` folder. For Netlify, Vercel, Cloudflare Pages, or another static host, use:

- Build command: `npm run build`
- Output directory: `dist`

No backend environment variables are required.

### Cloudflare Pages

This project is safe to deploy to Cloudflare Pages as a static site:

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`

Because app data is stored in browser `localStorage`, there is no backend or database to configure for deployment.

Because the app does not set cookies, it does not need a cookie consent popup for its own storage. If you add third-party analytics, ads, or tracking later, add consent before enabling those services.
