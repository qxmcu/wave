# Accounts

Wave has no server of its own. Sign-in happens on Google's and Spotify's own
pages inside the app, and credentials are stored on your machine, encrypted
with the OS keychain (`safeStorage`) where available.

## YouTube Music (Google)

Nothing to set up. Login page → **YouTube Music** tab → **Sign in with Google**.

- A window opens on Google's sign-in page. After you sign in, Wave reads the
  YouTube cookies from that window's session and closes it.
- The session is kept in its own partition (`persist:wave-google`), so on the
  next launch Wave signs back in by itself.
- Your YouTube Music library playlists and liked songs show up under your
  profile and refresh every few minutes. Likes made in Wave are sent back to
  YouTube Music.
- Signing out (avatar menu → Log out) clears that session.

## Spotify

Spotify only lets registered apps use its Web API, so you need a **Client ID**
(free, no secret required, Wave uses the PKCE flow).

1. Go to <https://developer.spotify.com/dashboard> and create an app.
2. Redirect URI: `http://127.0.0.1:8898/callback` (exactly this).
3. APIs used: **Web API**.
4. Copy the **Client ID**.
5. In Wave: Login page → **Spotify** tab → paste it → **Sign in with Spotify**.

Notes:

- New Spotify apps run in _development mode_: only Spotify accounts you add
  under **User Management** in the dashboard can sign in (up to 25). To open it
  to everyone, request an extension from Spotify.
- To ship a build where users never see the Client ID step, set it at build
  time: `MAIN_VITE_SPOTIFY_CLIENT_ID=<id>` in a `.env` file locally, or the
  `SPOTIFY_CLIENT_ID` repository secret for the GitHub Actions build.
- Playlist links from Spotify import without signing in.

## Apple Music and Amazon Music

There is no sign-in for these. Import their playlists instead
(Playlist → Import):

- **Apple Music**: paste a public playlist or album link.
- **Amazon Music**: paste a shared link. Amazon has no public API, so this
  only works when the page includes its track list. If it doesn't, export the
  playlist to CSV (TuneMyMusic, Soundiiz) and use the file import.
