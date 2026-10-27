<h2 align="center">🌊 Wave</h2>

Wave is a desktop music player for **YouTube Music** and **Spotify**, with playlist import from
**Apple Music, YouTube, Spotify and Amazon Music**. It is built on the UI of
[AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer) (MIT), with the NetEase Cloud Music
backend replaced by a new local backend in `src/main/wave`.

## Features

- Search, browse, charts, new releases, artist/album pages and radio from YouTube Music
- Playback of YouTube Music audio; Spotify, Apple Music and imported tracks are matched to the same
  recording on YouTube Music (Spotify only allows streaming inside its own apps)
- Synced lyrics from [LRCLIB](https://lrclib.net), falling back to YouTube Music lyrics
- **Sign in with Google** (YouTube Music) — library playlists and likes sync automatically, and an
  existing Google session is picked up on start-up
- **Sign in with Spotify** — playlists and Liked Songs sync automatically
- **Sign in with Apple ID** (MusicKit) — Apple Music library playlists sync automatically
- Playlist import (Playlist → Import) from:
  - YouTube / YouTube Music playlist, album and video links
  - Spotify playlist, album and track links (works without signing in)
  - Apple Music playlist and album links (works without signing in)
  - Amazon Music and other shared pages that publish schema.org playlist data
  - Text (`Song - Artist` per line) and CSV exports (Exportify, TuneMyMusic, Soundiiz…)
- Local library: liked songs, your own playlists, listening history, downloads, local files, EQ,
  desktop lyrics, mini player and everything else from the original UI

## Accounts and credentials

No Firebase or other backend service is needed: everything runs locally inside the app.

| Service | What you need |
| --- | --- |
| YouTube Music | Nothing. "Sign in with Google" opens Google's own sign-in page. |
| Spotify | A free Spotify app **Client ID**. Create an app at <https://developer.spotify.com/dashboard>, add the redirect URI `http://127.0.0.1:8898/callback`, enable *Web API*, and paste the Client ID in the Spotify tab of the login page (or put `MAIN_VITE_SPOTIFY_CLIENT_ID=...` in a `.env` file before building so users never see this step). New Spotify apps are in development mode: add each user's Spotify email under *User Management*. |
| Apple Music | A MusicKit developer token, which requires an Apple Developer account. Paste a token, or paste the `.p8` MusicKit private key and enter its Team ID and Key ID — Wave signs tokens locally. To ship a token with the app, put `MAIN_VITE_APPLE_DEVELOPER_TOKEN=...` in `.env` before building. Public Apple Music links import without any of this. |
| Amazon Music | Amazon has no public API; shared links work when the page exposes its track list, otherwise export the playlist to CSV and import the file. |

## Development

```bash
npm install
npm run dev          # run the app
npm test             # unit and API tests
npm run typecheck
npm run build:win    # or build:mac / build:linux
```

## License

MIT. Original work © Alger (AlgerMusicPlayer); see [LICENSE](LICENSE).
