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
