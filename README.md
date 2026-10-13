# SmileWeb 😄

Smile at your webcam and SmileWeb hands you a fresh, family-friendly joke.

It is a **privacy-first, zero-build static site**: vanilla ES modules, no
framework, no bundler, no server-side code. Smile detection runs entirely on
your device with WebAssembly; camera frames are measured and thrown away. The
joke library ships as plain JSON that is streamed a category at a time.

```
webcam ──► MediaPipe face landmarks ──► smile blendshapes ──► SmileTracker
                                                                  │
                                              "keep smiling and enjoy your day"
                                                                  │
                                                             ┌────▼────┐
                                                             │  joke   │
                                                             └─────────┘
```

## Highlights

- **10,000+ jokes** (dad jokes, puns, knock-knock, riddles, one-liners and
  more) validated for length, tone and duplicates by the build pipeline.
- **On-device smile detection** using MediaPipe Tasks Vision
  (`mouthSmileLeft` / `mouthSmileRight` blendshapes) with exponential smoothing,
  hysteresis and hold/release windows so a cough never counts.
- **Progressive by design.** No camera, no model, no connection? The app still
  works as a full joke browser with search, categories and favourites.
- **Semantic, accessible HTML** and a modern CSS layer: design tokens,
  container queries, `prefers-color-scheme`, reduced-motion and forced-colors
  support, print styles and a skip link.
- **PWA**: installable, offline-capable through a small service worker, with
  pre-compressed responses from the bundled static server.
- **Tested**: Vitest unit suites for every pure module plus Playwright
  end-to-end tests that drive the real camera → smile → joke loop.

## Quick start

```bash
npm install          # dev dependencies (tests only)
npm run build        # harvest dad jokes, build the dataset, draw the icons
npm start            # serve on http://127.0.0.1:4173
```

Open the URL, press **Start smiling**, allow the camera and grin.

> Camera access requires a secure context. `http://localhost` and
> `http://127.0.0.1` count as secure, so the bundled server is enough.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build:jokes` | Validate + de-duplicate the banks into `data/`. |
| `npm run build:dadjokes` | (Re)harvest the icanhazdadjoke corpus. |
| `npm run build:icons` | Redraw the PNG icons from `assets/icon.svg`. |
| `npm start` / `npm run dev` | Serve the site with production headers. |
| `npm test` | Unit tests, then end-to-end tests. |
| `npm run test:unit` | Vitest (jsdom). |
| `npm run test:e2e` | Playwright against the bundled server. |
| `npm run verify` | Full self-check: build + artefact + dataset integrity. |
| `npm run lint` | `oxlint` over the codebase. |

## Project layout

```
index.html            semantic shell (landmarks, dialogs, live regions)
css/styles.css        layered, token-driven stylesheet
js/
  app.js              controller: wiring, camera session, detection loop
  camera.js           getUserMedia plumbing + friendly errors
  face-model.js       lazy MediaPipe wrapper (with a test seam)
  smile-engine.js     pure smile scoring + hysteresis tracker
  jokes.js            manifest/category loading, deck draw, search
  stats.js            local smile statistics + streaks
  storage.js          defensive localStorage wrapper
  theme.js            auto / light / dark theme controller
  ui.js               DOM rendering helpers
  util.js             tiny pure helpers
  celebration.js      confetti + haptics
data/                 generated joke JSON + manifest (built, not hand-edited)
tools/
  build-jokes.mjs     dataset pipeline
  data/banks/*.mjs    hand-authored joke banks
  data/validate.mjs   shared joke validation + fingerprinting
assets/               PWA manifest + icons
scripts/              static server, icon renderer, self-check
tests/unit            Vitest suites
tests/e2e             Playwright specs
```

## How the smile detector stays calm

`js/smile-engine.js` turns a stream of noisy per-frame blendshapes into one
stable signal:

1. **Exponential smoothing** — every frame is blended into a running average.
2. **Hysteresis** — a smile starts above `ON` (0.42) and only ends below `OFF`
   (0.30), so the indicator cannot flap around one threshold.
3. **Time in state** — the score must stay high for `HOLD_MS` (320 ms) to start
   and low for `RELEASE_MS` (650 ms) to end.
4. **Cooldown** — celebrations are spaced at least `COOLDOWN_MS` (1200 ms)
   apart so one long grin does not spam jokes.

All of the tuning lives in `js/constants.js`.

## Extending the joke library

Jokes live in `tools/data/banks/*.mjs`:

```js
export default {
  category: 'Puns',
  jokes: [
    'I used to be a banker, but I lost interest.',
    'Why did the bicycle fall over?\n\nIt was two-tired.',
  ],
};
```

A joke is a string. Use a single blank line (`\n\n`) to split a setup from its
punchline. `tools/data/validate.mjs` rejects anything too short, too long,
missing punctuation, shouting, duplicated or containing blocked words, and
`npm run build:jokes` reports exactly what was dropped. Categories are merged
by name, and the display order in the UI comes from `CATEGORY_ORDER` in the
builder.

## Privacy

Everything runs locally: no accounts, no analytics, no tracking cookies and no
video ever leaves the device. The app only downloads the face-landmark model
(one time, from Google Storage) and the WASM runtime (from jsDelivr/unpkg);
both are cached by the service worker. Statistics and favourites are stored in
`localStorage` under the `smileweb:` namespace and can be cleared with one
button.

## License

MIT.
