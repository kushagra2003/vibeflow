# VibeFlow MVP: setup in plain English

**Works now:** search Audius, play real tracks, queue (play now / next / reorder / remove), shuffle, repeat, favourites, history,
AI Radio with 3 AI picks, session restore, diagnostics. Data is saved in your browser (guest mode).
**Not built yet:** Firebase sign-in and rules, YouTube player, ytmusicapi adapter, crossfade, ai-transition.

## 1. Get your keys
- **AI key:** any OpenAI-compatible provider works. For Nara Router: sign up at router.naraya.ai/keys and copy your key and the model name and base URL from its docs.
- **Audius (recommended):** audius.co/settings, create a new app, copy its API key.

## 2. Put it online with Netlify
1. Create a GitHub repository and upload every file in this folder.
2. At app.netlify.com choose Add new site, Import from Git, pick the repository, leave the build command empty, deploy.
3. Site configuration, Environment variables, add:
   - `AI_API_KEY` = your AI provider key
   - `AI_BASE_URL` = provider base URL ending in /v1 (leave out for OpenAI)
   - `AI_MODEL` = the model name from the provider's docs
   - `AUDIUS_API_KEY` = your Audius key (optional)
4. Deploys, Trigger deploy, so the keys take effect.

## 3. Check it works
Open the site, then Diagnostics. You want `audius: "ok"` and `aiKeySet: true`.
Test: search a song, Play now, pause/resume, Queue two songs, Play next, reorder with the arrows,
turn on AI Radio, confirm three picks appear, reload the page and see the queue return.

## Troubleshooting
- "AI_API_KEY is not set": add the variable and redeploy.
- "Could not reach Audius": try again and check Diagnostics.
- A track is skipped automatically: Audius does not allow streaming that track.
- Nothing plays on first click: browsers block autoplay, so press the play button.
- Running locally needs `npx netlify dev`; opening index.html directly will not work.
