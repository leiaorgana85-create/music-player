# MUSIC — Personal iPhone Player

This is a small installable web app (PWA) configured for the Google Drive folder:

`MUSIC` — folder ID `1W8s8gT5p60nOqXv_VvPy6l9uofZAog9E`

## What it does

- Reads songs directly from the private Google Drive MUSIC folder.
- Keeps duplicate files as separate tracks because Google Drive file IDs are unique.
- Fixed playlists: **GYM**, **CHILL**, **BOSSANOVA**.
- Add one song to multiple playlists without duplicating the audio file.
- **Download all** stores local copies in iPhone browser storage for airplane/offline playback.
- **Refresh** adds new Drive songs and removes songs that were deleted from Drive.
- If a Drive file changes, the stale offline copy is discarded so it can be downloaded again.
- Search, shuffle, repeat, previous/next, scrub/seek.
- Uses iOS Media Session controls when Safari/iOS exposes them.

## One-time Google setup

The MUSIC folder is private, so Google requires OAuth. No secret key is placed in this app.

1. Go to Google Cloud Console and create a small project (for example `Personal Music Player`).
2. Enable **Google Drive API** for that project.
3. Configure the OAuth consent screen. For a personal project, keep it in Testing and add your own Google account as a test user if Google asks.
4. Create an **OAuth 2.0 Client ID** of type **Web application**.
5. Add this exact origin under **Authorized JavaScript origins**: `https://leiaorgana85-create.github.io`.
6. Copy the Client ID ending in `apps.googleusercontent.com`.
7. Open MUSIC → Settings → paste the Client ID → Save → **Connect Drive**.

The app requests only `drive.readonly`. The Google access token is kept in memory and is not saved to localStorage or IndexedDB.

## Put it online

The easiest free hosting is GitHub Pages, Cloudflare Pages, Netlify, or another static HTTPS host. No server is required.

For GitHub Pages:

1. Create a repository and upload the contents of this folder (not the outer ZIP).
2. Enable Pages for the repository.
3. Open: `https://leiaorgana85-create.github.io/music-player/`.
4. Add that origin to the OAuth client's Authorized JavaScript origins.
5. On the iPhone, open the site in Safari → Share → **Add to Home Screen**.

## Prepare for a flight

1. Open the installed MUSIC app while on Wi‑Fi.
2. Tap **Connect Drive**, then **Refresh**.
3. Tap **Download all** and wait until the status says all songs are downloaded.
4. Test one or two tracks in Airplane Mode before travel.

### iPhone storage note

The downloaded music is stored in the PWA's IndexedDB storage. The app requests persistent storage where supported, but iOS ultimately controls browser storage and can evict web data under storage pressure. With this library (~228 MB as of October 11, 2026), normal storage demand is small. Before a long trip, verify the downloaded count and test Airplane Mode.

## File formats

Current MUSIC contents are MP3. The app also accepts common M4A/AAC and FLAC MIME types. There is no need to recompress the current 228 MB library unless you specifically want to save phone storage.

## Updating the library later

- Add or delete songs in Google Drive MUSIC.
- When online, open the app and tap **Refresh**.
- New tracks appear in All Songs.
- Deleted Drive tracks disappear from the app and their offline copies are removed.
- Playlist membership is stored locally on this iPhone. If you want playlist membership synced across devices later, that can be added as a second phase.
