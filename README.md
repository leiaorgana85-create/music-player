# Lexi Music — iPhone PWA Runbook

Canonical operating notes for the personal Lexi Music iPhone web app.

- **Repo:** `leiaorgana85-create/music-player`
- **App:** `https://leiaorgana85-create.github.io/music-player/`
- **Google Drive master folder:** `MUSIC`
- **Drive folder ID:** `1W8s8gT5p60nOqXv_VvPy6l9uofZAog9E`
- **Home Screen icon asset:** `https://leiaorgana85-create.github.io/lexi-assets/music-logo.png`

## Critical iPhone install rule

**Do not use an iOS Shortcut as the Lexi Music launcher.** A Shortcut that opens the URL can hand the page to the default browser, which is not the same standalone web-app context and can create confusing/separate storage behavior.

Install the real standalone PWA from **Safari**:

1. In Safari, open `https://leiaorgana85-create.github.io/music-player/`.
2. Tap **Share → Add to Home Screen**.
3. If iOS shows **Open as Web App**, leave it enabled.
4. Confirm the preview shows the Lexi Music cat icon.
5. Tap **Add**.
6. Launch the Home Screen icon and confirm it opens standalone with no browser address bar.
7. Before downloading music, open **⚙︎ Settings → Storage** and confirm **Offline audio = 0 songs · 0 MB** on a clean install.

The custom icon is supplied by `manifest.json`; no Shortcut wrapper is needed.

## Storage architecture

Google Drive `MUSIC` is the master song source. Device-local data is split deliberately:

### Library database

- **Database:** `music-pwa-db`
- **Version:** `1`
- **Owner:** local library metadata/rows
- Existing installs may still contain the historical `audio` object store in this database schema, but Lexi Music no longer reads or writes offline audio there.

Keeping `music-pwa-db` at version 1 avoids a destructive database migration and preserves the existing library during normal updates.

### Offline-audio database

- **Database:** `music-pwa-audio-db`
- **Version:** `1`
- **Store:** `audio`
- **Owner:** downloaded offline song bytes only
- **Key:** Google Drive file ID

`audio-storage.js` owns all operations against the dedicated audio database. `app.js` explicitly routes every audio get/getAll/put/delete through this module; library operations continue through `music-pwa-db`. There is no fallback that writes new audio into the historical shared store.

On WebKit/iOS, audio is stored in a structured-clone-safe ArrayBuffer wrapper and reconstructed as a Blob only when playback needs an object URL.

## Storage numbers in Settings

**Offline audio** is the authoritative Lexi Music number. It enumerates every row in `music-pwa-audio-db → audio` and sums the stored bytes.

**WebKit storage estimate** comes from `navigator.storage.estimate()`. It is only an origin/container estimate. It can include app-shell cache, database overhead, and allocated-but-unused database space. It can remain high even when Offline audio is exactly `0 songs · 0 MB`.

Do not use iPhone Safari website-data totals or Safari cookie clearing as a proxy for the installed Home Screen app. Safari and the standalone PWA can have separate WebKit storage containers.

## Correct way to delete offline songs

Google Drive remains the master copy. **Do not delete Drive files merely to free phone storage.**

### Selected downloads

1. Open **Downloaded**.
2. Tap **Select**.
3. Select the downloaded songs.
4. Tap **Remove download**.
5. Lexi Music removes only those rows from `music-pwa-audio-db`.

The library and Drive files remain.

### All offline audio

1. Open **⚙︎ Settings → Storage**.
2. Review the exact Offline audio count and size.
3. Tap **Delete all offline audio**.
4. Confirm the deletion.
5. Lexi Music closes `music-pwa-audio-db`, calls `indexedDB.deleteDatabase('music-pwa-audio-db')`, then recreates a fresh empty database.
6. The app verifies the recreated database reports **0 songs · 0 MB** before recording success.

This is intentionally stronger than clearing rows inside a long-lived database because WebKit may retain free pages in a database backing file after `objectStore.clear()`.

Bulk deletion keeps:

- Google Drive files
- local library rows
- settings
- playlists/Favorites if present

The **WebKit storage estimate may still include storage retained from the historical shared database or other WebKit allocation**; only Offline audio is the exact live downloaded-audio measurement.

### Start completely brand new on this device

Use **⚙︎ Settings → Storage → Reset Lexi Music on this device** only when the owner intentionally wants to wipe all Lexi Music state from that installed web-app container and rebuild from Google Drive.

The reset opens `reset.html` after leaving the running player page so its IndexedDB connections are closed, then deletes only Lexi Music-owned data:

- `music-pwa-audio-db`
- the entire historical `music-pwa-db`, including the old shared audio allocation and local library rows
- `musicPwaSettings`
- `musicPwaPlaylists`
- `musicPwaCustomPlaylists`
- `musicPwaFavorites`
- session keys beginning with `music`
- Cache Storage entries whose names begin with `music-shell-`
- the service-worker registration scoped to `/music-player/`

It deliberately does **not** clear origin-wide localStorage, all Cache Storage, or other GitHub Pages service workers because Spend, Travel and Notes share the same `leiaorgana85-create.github.io` origin. Google Drive files are never deleted.

The reset records WebKit storage usage before and after the targeted deletion and then returns to a fresh Lexi Music app. On the fresh load, default OAuth/folder configuration is recreated by source, the local library is empty, playlists/Favorites are empty, and the owner can connect/refresh Drive and download again.

If WebKit still reports a large residual after both Lexi Music databases and Music caches are successfully deleted, treat that as a separate WebKit container-level retention problem; do not assume live Lexi Music rows remain.

## Important distinction: “Remove from device”

The per-song **Remove from device** command is more destructive than **Remove download**. It deletes that song's:

- dedicated offline-audio row first
- local library row second
- playlist memberships and Favorite status afterward

It **does not delete the Google Drive file**. If the Drive file still exists, a later Refresh can add the library row back, but removed playlist/Favorite membership is not automatically restored.

The audio and library rows live in separate IndexedDB databases, so they cannot be one cross-database atomic transaction. The sequence deliberately deletes the audio row first and cleans collections only after the local song removal succeeds.

## Drive Refresh safety rule

**Refresh is merge-only.**

A Refresh adds/updates songs returned by Google Drive, but a missing Drive result does not automatically delete local library rows, offline audio, playlist membership, Favorites, or saved tags. This protects local state from partial/transient Drive listings or API failures.

Permanent song removal remains: delete the Drive master and remove the local app entry as needed.

## Offline/download behavior

- A local audio row counts as a current download only when it contains usable bytes and matches the current Drive file size; when both revision timestamps are available, they must match too.
- If Drive reports a newer/different revision, an older local copy is preserved until a verified replacement succeeds. It is not counted as current in **Downloaded** and is eligible for re-download.
- If the phone is offline and only an older saved copy exists, Lexi Music may still play it and labels it **Playing saved older copy**.
- **Download all** and **Download view** download tracks that do not have a current validated offline copy.
- Playback checks `music-pwa-audio-db` first. If a current copy is present, the app reports **Playing offline**.
- If a current offline copy is absent and the phone is online, the app fetches the song from Google Drive.
- `audio-storage.js` has its own stale/closed IndexedDB reconnect-and-retry path for the dedicated audio database.
- `app.js` retains reconnect/retry handling for `music-pwa-db` library operations.
- The service worker caches the app shell, including `audio-storage.js`; it does not cache Google Drive audio as offline song storage.
- The Music service worker may delete only cache names beginning with `music-shell-`; it must never delete Spend/Notes/Parents caches on the shared GitHub Pages origin.
- The app requests persistent browser storage where supported, but iOS ultimately controls web-storage eviction and physical allocation.

Before a flight, download the desired songs and test at least one or two tracks in Airplane Mode.

## Other local data

The following remain in localStorage during normal use:

- Settings: `musicPwaSettings`
- Built-in playlists: `musicPwaPlaylists`
- Custom playlists: `musicPwaCustomPlaylists`
- Favorites: `musicPwaFavorites`

Playlist backup/restore uses the complete version-2 implementation in `playlist-enhancements.js`. Downloaded audio is not included in playlist backup.

## Google authorization

The private Drive folder is accessed with Google OAuth using `drive.readonly`.

- OAuth Client ID and Drive folder ID are stored locally for app configuration.
- The Google access token is memory-only and is not persisted to localStorage or IndexedDB.

Authorized JavaScript origin:

`https://leiaorgana85-create.github.io`

## Current iOS/Home Screen icon configuration

`manifest.json` uses:

- `name`: `Lexi Music`
- `short_name`: `Lexi Music`
- `display`: `standalone`
- icon: `/lexi-assets/music-logo.png`

## Change notes

### 2026-10-17 — dedicated offline-audio database + full local reset

- Added `audio-storage.js` and dedicated `music-pwa-audio-db` version 1.
- `app.js` explicitly routes all audio reads/writes/deletes to the dedicated database; the main `music-pwa-db` remains the normal library database.
- No new audio can silently fall back into the historical `music-pwa-db → audio` store.
- **Delete all offline audio** deletes the entire dedicated audio database and recreates/reads an empty database for verification.
- Added **Reset Lexi Music on this device** for an intentional true clean start. `reset.html` deletes both Lexi Music IndexedDB databases, Music-only localStorage/sessionStorage keys, `music-shell-*` caches and the `/music-player/` service worker, while leaving Google Drive and the other Lexi apps untouched.
- Settings labels the broad diagnostic number **WebKit storage estimate** and explains that it may include allocated-but-unused space.
- **Remove from device** deletes dedicated audio first and then the library row.
- Service-worker shell v41 caches `audio-storage.js?v=2`, `app.js?v=18`, and `player-ui.js?v=9`. The v41 activation cleanup is namespace-scoped to `music-shell-*` caches so Music cannot erase neighboring Lexi app caches on the shared origin.
- Repository/source verification is required before calling the change complete; installed-iPhone runtime smoke must separately confirm the reset's before→after WebKit storage number and the fresh Drive refresh/download flow.

### 2026-10-14 — integrity hardening

- Kept `music-pwa-db` at version 1 and preserved existing local library data.
- Added current-offline validation using stored bytes, Drive size, and revision timestamp when available.
- Removed global Response/URL monkey patches; structured audio conversion stays local to the music code path.
- Hardened Remove from device sequencing and complete playlist backup/restore.
- Installed-iPhone smoke at that time passed library/playlists/Favorites preservation, normal and Airplane Mode playback, storage count/size consistency, and backup Share-sheet behavior.

### 2026-10-12

- Added exact in-app offline-audio count/byte reporting and verified bulk deletion in `player-ui.js`.
- Added the Lexi Music cat icon to the web-app manifest.

When troubleshooting future iPhone install/storage issues, read this README and the current repo source before giving instructions.
