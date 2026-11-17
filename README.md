# VibeFlow

VIBE FLOW is a browser-based AI DJ prototype. The player, library, queue, hook scanner and local transition-learning features run in the browser.

## Hosting

The static frontend is hosted on Cloudflare Pages. The current lyrics lookup feature runs entirely in the browser and needs no separate backend.

## Lyrics retrieval

VIBE LYRICS Studio retrieves existing timed lyrics directly from public provider APIs:

1. [Better Lyrics](https://docs.betterlyrics.org/) — primary source. The default endpoint returns TTML with syllable timing when a cached match is available. The Kugou endpoint is tried as a line-timed fallback.
2. [LRCLIB](https://lrclib.net/docs) — fallback for synced LRC lyrics, with plain lyrics as a last-resort result.

The browser calls these public APIs directly; both document browser access. No API key or separate backend is required for the current implementation. Provider availability, cache coverage and rate limits are outside VIBE FLOW's control. LRCLIB asks clients to identify themselves and respect its rate limits; the UI makes individual lookups rather than bulk library scans.

### Use it

1. Deploy the `main` branch to Cloudflare Pages (or wait for this pull request to be merged and deployed).
2. Open VIBE LYRICS Studio.
3. Enter a song title and artist, or click **Use currently playing**.
4. Add album and exact duration where known to improve matching.
5. Click **Find synced lyrics**.
6. Review/edit the returned lines and export JSON.

The Better Lyrics default endpoint can return HTTP 401 for an uncached song because fresh upstream lookups may require an API key, which is not currently being issued broadly. The app then tries the no-key Kugou provider and LRCLIB. Results may be unavailable, unsynced, or line-synced rather than syllable-synced.

Lyrics are third-party content. Before distributing or storing lyrics in a public/commercial product, review the providers' terms and the rights applicable to the lyrics. VIBE FLOW does not claim ownership of retrieved lyrics.

## Local development

Open the static site through a local static server or the Cloudflare Pages preview workflow. The lyrics lookup feature does not require a Python environment or local API proxy.


## Intelligent audio mixing (browser-side)

The queue-aware VIBE LYRICS workflow can also run a local Web Audio structure scan on the current and next tracks. It estimates BPM from a fine-grained onset envelope, builds a beat/bar/8-bar phrase grid, estimates low-energy intro/outro boundaries, and detects repeated/high-energy sections as candidate cue points. The DJ engine can align incoming hook starts and outgoing automatic transition deadlines to detected musical phrase boundaries.

This processing runs in the browser and downloads/decodes the selected audio for analysis. It does not upload audio to a Python service. Browser analysis requires the audio URL to be fetchable with CORS enabled and the browser to decode its format; remote catalogue streams may not permit this. Local files in the deployed `songs/` folder are the most reliable input.

**Interpretation limits:** BPM and phrase boundaries are estimates and may be wrong on live recordings, tempo changes, half-time/double-time grooves, edits and syncopated music. Energy analysis is not vocal detection or source separation. It cannot reliably identify lyrics, vocal emotion, drops or the exact musical end of a vocal phrase. The engine therefore labels these as candidate/heuristic cues, retains existing manual hooks, and falls back to existing timing when confidence or analysis is unavailable. It does not claim a guaranteed perfect mix.


## Vocal-aware analysis architecture

- `js/audio-analysis.worker.js` moves the expensive PCM frame, onset, BPM, beat/bar/phrase and energy calculations into a dedicated Web Worker. The main thread only fetches/decodes audio and transfers decoded channel buffers to the worker; it does not run the sample-analysis loops.
- Worker jobs have a 60-second timeout, deduplicate by audio URL, and reject audio larger than 45 MB or longer than 12 minutes to limit memory use.
- `js/vocal-intelligence.js` builds a vocal timeline from synced lyric-line timestamps or word-level timestamps. It marks positive vocal windows and candidate gaps.
- The DJ bridge stores these maps with queue tracks so a future transition planner can inspect both songs.

**Important safety boundary:** synced lyrics tell us where known lyric lines occur; they do not prove that the gaps contain no backing vocals, ad-libs or wordless singing. The current browser waveform worker does not detect vocals. Its output explicitly says `vocalStatus: "not-detected"`. The planner therefore returns candidate-only, never `safe: true`. Do not enable automatic instrumental-only transitions until a real vocal-activity model or source-separated vocal stem has been evaluated on a representative music set.


## Shared hook backup (GitHub)

Hooks are still cached locally for offline resilience, and are also synchronized to the repository's `hooks.json` through a Cloudflare Pages Function. This makes saved hooks available to every browser/device using the deployed site. The Pages Function keeps the GitHub token server-side; never put a GitHub token in frontend JavaScript.

### One-time Cloudflare setup

1. Deploy the repository to Cloudflare Pages with Functions enabled (the `functions/api/hooks.js` file is picked up automatically by Pages).
2. In Cloudflare Pages → your project → Settings → Variables and Secrets, add **`GITHUB_TOKEN`** as an encrypted secret. Use a fine-grained GitHub token scoped only to this repository with **Contents: Read and write** permission.
3. Optionally set `GITHUB_REPOSITORY` (defaults to `kushagra2003/vibeflow`) and `GITHUB_BRANCH` (defaults to `main`).
4. Redeploy the Pages project so the Function receives the secret.
5. Open VIBE FLOW, let the library load, and save or rename a hook. The status will show that shared hooks are loaded/backed up when synchronization is working.

The endpoint merges hook lists by stable hook ID instead of replacing the entire shared archive, reducing the chance that two browsers overwrite one another. Existing browser-local hooks are merged into the shared archive on load. Until the Cloudflare secret is configured, the app continues to use localStorage and the manual JSON export/import controls.
