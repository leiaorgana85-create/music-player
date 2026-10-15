# Lexi Music — iPhone PWA Runbook

Canonical operating notes for the personal Lexi Music iPhone web app.

- **Repo:** `leiaorgana85-create/music-player`
- **App:** `https://leiaorgana85-create.github.io/music-player/`
- **Google Drive master folder:** `MUSIC`
- **Drive folder ID:** `1W8s8gT5p60nOqXv_VvPy6l9uofZAog9E`
- **Home Screen icon asset:** `https://leiaorgana85-create.github.io/lexi-assets/music-logo.png`

## Critical iPhone install rule

**Do not use an iOS Shortcut as the Lexi Music launcher.** A Shortcut that opens the URL can hand the page to the default browser (for example Brave), which is not the same standalone web-app context and can create confusing/separate storage behavior.

Install the real standalone PWA from **Safari**:

1. In Safari, open `https://leiaorgana85-create.github.io/music-player/`.
2. Tap **Share → Add to Home Screen**.
3. If iOS shows **Open as Web App**, leave it enabled.
4. Confirm the preview shows the Lexi Music cat icon.
5. Tap **Add**.
6. Launch the new Home Screen icon and confirm it opens **standalone** with no Safari or Brave address bar.
7. Before downloading music, open **⚙︎ Settings → Storage** and confirm **Offline audio = 0 songs · 0 MB** on a clean install.

The custom icon is supplied by `manifest.json`; no Shortcut wrapper is needed.

If replacing an older Home Screen installation, first verify the new Lexi Music icon opens standalone and has the expected storage state. Then the old Home Screen installation can be removed. Do not delete the new installation by mistake.

## Where offline music is actually stored

Offline audio is not stored as visible files in the iPhone Files app.

Lexi Music uses IndexedDB:

- **Database:** `music-pwa-db`
- **Database version:** `1`
- **`library` store:** saved library metadata/rows
- **`audio` store:** downloaded offline song audio

Downloaded audio is stored in the `audio` object store keyed by the Google Drive file ID. On WebKit/iOS, the app uses a structured-clone-safe ArrayBuffer wrapper for the stored audio value and reconstructs a Blob only when playback needs an object URL.

The app's **Settings → Storage → Offline audio** value is the authoritative Lexi Music offline-audio measurement. It directly reads every row in the IndexedDB `audio` store and sums the stored audio bytes.

**Do not infer Lexi Music audio usage from iPhone Storage → Brave/Safari Documents & Data.** Browser storage totals include other data and are not a reliable measure of Lexi Music offline songs.

The separate **Site storage estimate** shown in Settings comes from the browser storage estimate API and is only a diagnostic estimate. It may include cache/database overhead and should not be treated as the exact offline-music size.

## Correct way to delete offline songs

### Free phone storage but keep the songs in Google Drive

Google Drive remains the master copy. **Do not delete the Drive files.**

For selected songs:

1. Open **Downloaded**.
2. Tap **Select**.
3. Select the downloaded songs.
4. Tap **Remove download**.
5. Lexi Music deletes only those rows from the IndexedDB `audio` store; the library, playlists, Favorites, and Drive files remain.

For all offline songs:

1. Open **⚙︎ Settings → Storage**.
2. Review the exact count and size, for example `73 songs · 684.2 MB`.
3. Tap **Delete all offline audio**.
4. Confirm the deletion.
5. Lexi Music clears the IndexedDB `audio` store and then reads it again.
6. Treat deletion as complete only after Lexi Music reports **Verified: 0 songs · 0 MB offline**.

The bulk Storage delete intentionally keeps:

- Google Drive files
- local library rows
- playlists
- Favorites

### Before removing/reinstalling the Home Screen app

Use this sequence:

1. **Lexi Music → Settings → Storage → Delete all offline audio**.
2. Wait for **Verified: 0 songs · 0 MB offline**.
3. Only then remove/reinstall the Home Screen web app if needed.

This is the normal cleanup method. Do not rely on clearing all Brave/Safari data or guessing from iPhone Storage unless troubleshooting a broken/abandoned browser container.

## Important distinction: “Remove from device”

The per-song **Remove from device** command is more destructive than **Remove download**. It deletes that song's:

- local library row
- offline audio
- built-in and custom playlist memberships
- Favorite status

It **does not delete the Google Drive file**. If the Drive file still exists, a later Refresh can add the library row back, but the prior playlist/Favorite membership is not automatically restored.

The local `library` + `audio` deletion is committed first. Playlist/Favorite references are cleaned only after that succeeds, so a failed IndexedDB delete does not silently strip playlist membership.

Use **Remove download** when the goal is only to free iPhone storage.

## Drive Refresh safety rule

**Refresh is merge-only.** This is deliberate.

A Refresh adds/updates songs returned by Google Drive, but a missing Drive result does **not** automatically delete local library rows, offline audio, playlist membership, Favorites, or saved tags. This protects the local library from partial/transient Drive listings or API failures.

Therefore, deleting a file from Google Drive is not the normal way to remove an offline download from the phone. Use Lexi Music's download-removal controls instead.

## Offline/download behavior

- A local audio row is treated as a **current download** only when it contains usable bytes and matches the current library file size; when both revision timestamps are available, they must match too.
- If Drive reports a newer/different revision, the older local audio row is preserved until a verified replacement download succeeds. It is not counted as current in **Downloaded** and will be eligible for re-download.
- If the phone is offline and only that older saved copy exists, Lexi Music may still play it and labels it **Playing saved older copy**. Its embedded metadata is not written back over the newer library record.
- **Download all** and **Download view** download tracks that do not have a current validated offline copy.
- Playback checks IndexedDB first. If the current audio copy is present, the app plays it locally and reports **Playing offline**.
- If the song is not current offline and the phone is online, the app fetches it from Google Drive for playback/download as appropriate.
- iOS/WebKit stale/closed IndexedDB connections are handled directly inside `app.js`: the failed database operation reopens `music-pwa-db` version 1 and retries once. No storage is cleared.
- The service worker caches the app shell from the GitHub Pages origin; it does **not** rewrite `app.js` and does not cache Google Drive audio as offline song storage.
- The app requests persistent browser storage where supported, but iOS ultimately controls web storage and may evict it under storage pressure.

Before a flight, download the desired songs and test at least one or two tracks in Airplane Mode.

## Other local data

The following are stored separately from the offline audio store:

- Settings: `localStorage` key `musicPwaSettings`
- Built-in playlists: `localStorage` key `musicPwaPlaylists`
- Custom playlists: `localStorage` key `musicPwaCustomPlaylists`
- Favorites: `localStorage` key `musicPwaFavorites`

Custom playlist names/contents are read directly from their dedicated localStorage object; Lexi Music does not modify `Object.prototype` to expose them.

Playlist backup/restore has one complete version-2 implementation in `playlist-enhancements.js`. It includes built-in playlists, custom playlists, their stored order, and Favorites. Downloaded audio is not copied or changed. If that module is unavailable, the base app fails closed instead of silently creating an incomplete backup.

## Google authorization

The private Drive folder is accessed with Google OAuth using `drive.readonly`.

- OAuth Client ID and Drive folder ID are stored locally for app configuration.
- The Google access token is kept in memory only and is not persisted to localStorage or IndexedDB.

Authorized JavaScript origin:

`https://leiaorgana85-create.github.io`

## Current iOS/Home Screen icon configuration

`manifest.json` is configured with:

- `name`: `Lexi Music`
- `short_name`: `Lexi Music`
- `display`: `standalone`
- icon: `/lexi-assets/music-logo.png`

The install preview should show the cat icon before tapping **Add**.

## Change notes

### 2026-10-14 integrity hardening

- Kept `music-pwa-db` at **version 1**; no database migration, storage reset, or local-data clearing was introduced.
- Moved IndexedDB reconnect/retry handling into `app.js`; removed service-worker source rewriting.
- Added current-offline validation using stored bytes, Drive size, and revision timestamp when available; stale copies are preserved until replacement succeeds.
- Removed the global `Response.prototype.blob` / `URL.createObjectURL` monkey patches; structured audio conversion is now local to the music code path.
- Made **Remove from device** sequence its IndexedDB delete before playlist/Favorite cleanup and include custom playlists.
- Removed custom-playlist `Object.prototype` accessors; app and enhancement module now read/write the custom-playlist localStorage object directly.
- Made version-2 playlist backup/restore the only complete backup path; the base app now fails closed if the enhancement module is unavailable.
- Removed obsolete `db-resilience.js` and `settings-ui.js` files.
- Installed iPhone runtime smoke passed: the existing Home Screen PWA reopened with library/playlists/Favorites intact; downloaded playback worked normally and in Airplane Mode; Offline audio count/size remained consistent; and Export backup opened the iOS share sheet.

### 2026-10-12

- Added exact in-app offline-audio count/byte reporting and verified bulk deletion in `player-ui.js`.
  - Commit: `a9e7a6c40dca998a6fc7840603b81d5547afedd6`
- Added the Lexi Music cat icon to the web-app manifest.
  - Commit: `30cbdf57ba5331ca90da0a0e0ee22efc147ed606`

When troubleshooting future iPhone install/storage issues, check this README and the current repo source before giving instructions.