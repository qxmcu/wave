# Architecture

Wave is an Electron app (electron-vite, Vue 3, Pinia, Naive UI).

```
src/
├── main/            Electron main process
│   ├── wave/        music backend (new in Wave)
│   ├── modules/     windows, tray, shortcuts, downloads, cache, MPRIS…
│   └── server.ts    starts the backend on 127.0.0.1
├── preload/         IPC bridge exposed to the renderer
├── renderer/        Vue UI (from AlgerMusicPlayer)
└── i18n/            en-US, zh-CN, zh-Hant, ja-JP, ko-KR
```

## Why there is a local HTTP server

The UI was written against the NetEase Cloud Music API: it calls paths like
`/cloudsearch`, `/playlist/detail` and `/song/url/v1` and expects NetEase's
response shapes with numeric ids. Rather than rewrite the UI, Wave serves the
same paths from `src/main/wave/routes.ts` on `127.0.0.1` (default port 30488)
and fills them with data from YouTube Music and Spotify. The UI code is mostly
untouched.

## Backend modules (`src/main/wave`)

| File                           | Job                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `routes.ts`                    | Express app. Maps NetEase-style endpoints to the services; audio proxy.                                                |
| `shapes.ts`                    | Converts Wave models to the response shapes the UI reads.                                                              |
| `ids.ts`                       | Service keys (`yt:v:<videoId>`, `sp:pl:<id>`…) ⇄ stable 52-bit numeric ids.                                            |
| `youtube.ts`                   | YouTube Music via [youtubei.js](https://github.com/LuanRT/YouTube.js): search, feeds, playlists, library, stream URLs. |
| `spotify.ts`                   | Spotify Web API (PKCE sign-in); public embed pages for signed-out link import.                                         |
| `matcher.ts`                   | Finds the YouTube Music recording for a Spotify/Apple/imported track (title, artist, duration scoring; cached).        |
| `importer.ts`                  | Import tasks for links, text and CSV; saves results as local playlists.                                                |
| `apple.ts`, `genericImport.ts` | Apple Music pages, schema.org pages (Amazon), text/CSV parsing.                                                        |
| `library.ts`                   | Local liked songs, playlists, history (JSON in the user data folder).                                                  |
| `lyrics.ts`                    | LRCLIB synced lyrics, YouTube Music lyrics as fallback.                                                                |
| `accounts.ts`, `auth.ts`       | Stored credentials and the Google/Spotify sign-in windows.                                                             |

## Playback

1. The UI asks `/song/url/v1?id=<id>`.
2. The backend resolves the id to a YouTube video, matching Spotify or imported
   tracks first if needed, and returns `http://127.0.0.1:<port>/wave/stream/<id>`.
3. `/wave/stream/<id>` fetches a stream URL from YouTube (trying several
   InnerTube clients) and proxies it with Range support, so seeking works and
   expired URLs are refreshed transparently on retry.

If that fails, the renderer's source chain falls back to the other enabled
sources (Settings → Playback).

## Data on disk

`<userData>/wave/`: `library.json`, `ids.json` (capped at 20k tracks),
`matches.json`, `saved.json`, `accounts.json` (encrypted via `safeStorage`),
`yt-cache/`.

## Resource use

In-memory caches are bounded (API responses 300 entries, stream URLs 200,
matches 500), JSON writes are batched, and the backend does no background
polling: service libraries are re-fetched at most every 5 minutes, and only
when the UI asks for them.

## Tests

`tests/wave.test.ts` covers ids, shapes, matching and the import parsers.
`tests/waveServer.test.ts` starts the real HTTP server with the YouTube module
mocked and exercises the endpoints the UI uses.
