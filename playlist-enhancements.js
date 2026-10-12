(() => {
  'use strict';

  const BUILTIN_PLAYLISTS = ['GYM', 'FEEL GOOD', 'BOSSA'];
  const PLAYLISTS_KEY = 'musicPwaPlaylists';
  const FAVORITES_KEY = 'musicPwaFavorites';
  const CUSTOM_KEY = 'musicPwaCustomPlaylists';
  const RESTORE_VIEW_KEY = 'musicPwaRestoreView';
  const BACKUP_VERSION = 2;

  const tabs = document.getElementById('tabs');
  const trackList = document.getElementById('trackList');
  const searchInput = document.getElementById('searchInput');
  const viewActions = document.querySelector('.view-actions');
  const selectBtn = document.getElementById('selectBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const bulkBar = document.getElementById('bulkBar');
  const playlistDialog = document.getElementById('playlistDialog');
  const playlistChoices = document.getElementById('playlistChoices');
  const savePlaylistsBtn = document.getElementById('savePlaylistsBtn');
  const exportBackupBtn = document.getElementById('exportBackupBtn');
  const importBackupBtn = document.getElementById('importBackupBtn');
  const backupFileInput = document.getElementById('backupFileInput');
  const playerPlaylistBtn = document.getElementById('playerPlaylistBtn');
  const removeDeviceBtn = document.getElementById('removeDeviceBtn');
  if (!tabs || !trackList || !viewActions || !selectBtn || !shuffleBtn) return;

  let reorderMode = false;
  let reorderView = '';
  let orderDirty = false;
  let pendingDialog = { mode: 'single', ids: [] };
  let lastPlayingId = null;
  const installedAccessors = new Set();

  const style = document.createElement('style');
  style.textContent = `
    .playlist-add-tab {
      white-space: nowrap; border: 1px dashed #56565f; background: transparent; border-radius: 999px;
      padding: 7px 10px; font-size: 11px; font-weight: 700; color: #c9c9cf;
    }
    .tab.custom-playlist-tab { border-color: #70658c; color: #c9b8f2; background: rgba(112,101,140,.14); }
    .tab.custom-playlist-tab.active { background: #d2c4f5; color: #0b0b0c; border-color: #d2c4f5; }
    .playlist-order-btn.active-order { color: #0b0b0c; background: #f3f3f4; border-color: #f3f3f4; }
    .playlist-manage-dialog .field input { font-size: 14px; }
    .playlist-delete-btn { border-color: #69404a !important; color: #f0a4bd !important; }
    .track-row.plugin-reordering { grid-template-columns: 38px minmax(0,1fr) 76px; }
    .track-row.plugin-reordering .track-favorite,
    .track-row.plugin-reordering .track-menu,
    .track-row.plugin-reordering .offline-badge { display: none !important; }
    .track-row.plugin-reordering .track-play,
    .track-row.plugin-reordering .track-body { pointer-events: none; }
    .manual-order-controls { display: flex; gap: 5px; justify-content: flex-end; padding-right: 2px; }
    .manual-order-controls button {
      width: 32px; height: 32px; border-radius: 8px; border: 1px solid #3a3a40;
      background: transparent; color: #f3f3f4; font-size: 17px; line-height: 1; padding: 0;
      -webkit-appearance: none; appearance: none;
    }
    .manual-order-controls button:disabled { opacity: .22; }
    body.playlist-reordering #shuffleBtn, body.playlist-reordering #selectBtn { opacity: .35; pointer-events: none; }
    @media (max-width:560px) {
      .playlist-add-tab, .tab.custom-playlist-tab { padding: 7px 9px; font-size: 10.5px; }
      .track-row.plugin-reordering { grid-template-columns: 34px minmax(0,1fr) 72px; }
      .manual-order-controls button { width: 30px; height: 30px; }
    }
  `;
  document.head.appendChild(style);

  function safeIds(value) {
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string'))] : [];
  }

  function readCustom() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean = Object.create(null);
      for (const [name, ids] of Object.entries(parsed)) {
        if (typeof name === 'string' && name.trim()) clean[name] = safeIds(ids);
      }
      return clean;
    } catch {
      return {};
    }
  }

  function writeCustom(data) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(data));
  }

  function customNames() {
    return Object.keys(readCustom());
  }

  function nameKey(name) {
    return String(name || '').trim().toLocaleUpperCase();
  }

  function reservedKeys(except = '') {
    const keys = new Set(['ALL', 'FAVORITES', 'DOWNLOADED', ...BUILTIN_PLAYLISTS].map(nameKey));
    for (const name of customNames()) {
      if (name !== except) keys.add(nameKey(name));
    }
    return keys;
  }

  function validateName(raw, except = '') {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Enter a playlist name.');
    if (name.length > 30) throw new Error('Playlist names can be up to 30 characters.');
    if (Object.prototype.hasOwnProperty.call(Object.prototype, name)) throw new Error('Please use a different playlist name.');
    if (reservedKeys(except).has(nameKey(name))) throw new Error('That playlist name is already in use.');
    return name;
  }

  function installAccessor(name) {
    if (installedAccessors.has(name)) return;
    if (Object.prototype.hasOwnProperty.call(Object.prototype, name)) return;
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      enumerable: false,
      get() {
        const playlistLike = BUILTIN_PLAYLISTS.every(key => Object.prototype.hasOwnProperty.call(this, key));
        return playlistLike ? safeIds(readCustom()[name]) : undefined;
      },
      set(value) {
        const playlistLike = BUILTIN_PLAYLISTS.every(key => Object.prototype.hasOwnProperty.call(this, key));
        if (!playlistLike) {
          Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true });
          return;
        }
        const data = readCustom();
        data[name] = safeIds(value);
        writeCustom(data);
      }
    });
    installedAccessors.add(name);
  }

  function uninstallAccessor(name) {
    if (!installedAccessors.has(name)) return;
    try { delete Object.prototype[name]; } catch {}
    installedAccessors.delete(name);
  }

  function installAllAccessors() {
    customNames().forEach(installAccessor);
  }

  function activeView() {
    return tabs.querySelector('.tab.active')?.dataset?.view || 'GYM';
  }

  function isCustom(name) {
    return customNames().includes(name);
  }

  function isPlaylist(name) {
    return BUILTIN_PLAYLISTS.includes(name) || isCustom(name);
  }

  function renderCustomTabs() {
    tabs.querySelectorAll('.custom-playlist-tab, .playlist-add-tab').forEach(node => node.remove());
    for (const name of customNames()) {
      installAccessor(name);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab custom-playlist-tab';
      button.dataset.view = name;
      button.textContent = name;
      tabs.appendChild(button);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'playlist-add-tab';
    add.id = 'addPlaylistTab';
    add.textContent = 'ï¼‹ PLAYLIST';
    add.setAttribute('aria-label', 'Create playlist');
    tabs.appendChild(add);
    updateHeaderControls();
  }

  function makeDialog(id, title) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'dialog playlist-manage-dialog';
    dial²È="24¡½É‘•É¥ÉÑä¤ì(€€€€€€€Í•ÍÍ¥½¹MÑ½É…”¹Í•Ñ%Ñ•´¡IMQ=I}Y%]}-d°Ñ…É•ÑY¥•Ü¤ì(€€€€€€€±½…Ñ¥½¸¹É•±½… ¤ì(€€€€€ô•±Í”ì(€€€€€€€™¥¹¥Í¡I•½É‘•È ¤ì(€€€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøÑ…‰Ì¹ÅÕ•ÉåM•±•Ñ½È¡€¹Ñ…‰m‘…Ñ„µÙ¥•Üôˆ‘íML¹•Í…Á”¡Ñ…É•ÑY¥•Ü¥ô‰u€¤ü¹±¥¬ ¤°€À¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€Í•ÑQ¥µ•½ÕÐ¡ÕÁ‘…Ñ•!•…‘•É½¹ÑÉ½±Ì°€À¤ì(€ô°ÑÉÕ”¤ì((€½¹ÍÐ±¥ÍÑ=‰Í•ÉÙ•È€ô¹•Ü5ÕÑ…Ñ¥½¹=‰Í•ÉÙ•È  ¤€ôøì(€€€½¹ÍÐÁ±…å¥¹œ€ôÑÉ…­1¥ÍÐ¹ÅÕ•ÉåM•±•Ñ½È œ¹ÑÉ…¬µÉ½Ü¹Á±…å¥¹œœ¤ì(€€€¥˜€¡Á±…å¥¹œü¹‘…Ñ…Í•Ðü¹¥¤±…ÍÑA±…å¥¹%€ôÁ±…å¥¹œ¹‘…Ñ…Í•Ð¹¥ì(€€€¥˜€¡É•½É‘•É5½‘”¤É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡‘•½É…Ñ•I•½É‘•ÉI½ÝÌ¤ì(€ô¤ì(€±¥ÍÑ=‰Í•ÉÙ•È¹½‰Í•ÉÙ”¡ÑÉ…­1¥ÍÐ°ì¡¥±‘1¥ÍÐèÑÉÕ”°ÍÕ‰ÑÉ•”è™…±Í”ô¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°•Ù•¹Ð€ôøì(€€€½¹ÍÐµ•¹Ô€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ œ¹ÑÉ…¬µµ•¹Ôœ¤ì(€€€¥˜€¡µ•¹Ô¤ì(€€€€€½¹ÍÐ¥€ôµ•¹Ô¹±½Í•ÍÐ œ¹ÑÉ…¬µÉ½Üœ¤ü¹‘…Ñ…Í•Ðü¹¥ì(€€€€€¥˜€¡¥¤Á•¹‘¥¹¥…±½œ€ôìµ½‘”è€Í¥¹±”œ°¥‘Ìèm¥‘tôì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ œ‰Õ±­‘‘	Ñ¸œ¤¤ì(€€€€€½¹ÍÐ¥‘Ì€ôl¸¸¹ÑÉ…­1¥ÍÐ¹ÅÕ•ÉåM•±•Ñ½É±° œ¹ÑÉ…¬µÉ½Ü¹Í•±•Ñ•œ¥t¹µ…À¡É½Ü€ôøÉ½Ü¹‘…Ñ…Í•Ð¹¥¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€Á•¹‘¥¹¥…±½œ€ôìµ½‘”è€…‘œ°¥‘Ìôì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡Á±…å•ÉA±…å±¥ÍÑ	Ñ¸€˜˜•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ œÁ±…å•ÉA±…å±¥ÍÑ	Ñ¸œ¤¤ì(€€€€€½¹ÍÐ¥€ôÑÉ…­1¥ÍÐ¹ÅÕ•ÉåM•±•Ñ½È œ¹ÑÉ…¬µÉ½Ü¹Á±…å¥¹œœ¤ü¹‘…Ñ…Í•Ðü¹¥ñð±…ÍÑA±…å¥¹%ì(€€€€€¥˜€¡¥¤Á•¹‘¥¹¥…±½œ€ôìµ½‘”è€Í¥¹±”œ°¥‘Ìèm¥‘tôì(€€€ô(€ô°ÑÉÕ”¤ì((€™Õ¹Ñ¥½¸…Õµ•¹ÑA±…å±¥ÍÑ¡½¥•Ì ¤ì(€€€¥˜€ …Á±…å±¥ÍÑ¡½¥•Ìñð€…Á±…å±¥ÍÑ¥…±½œü¹½Á•¸¤É•ÑÕÉ¸ì(€€€Á±…å±¥ÍÑ¡½¥•Ì¹ÅÕ•ÉåM•±•Ñ½É±° œ¹ÕÍÑ½´µÁ±…å±¥ÍÐµ¡½¥”œ¤¹™½É… ¡¹½‘”€ôø¹½‘”¹É•µ½Ù” ¤¤ì(€€€½¹ÍÐ‘…Ñ„€ôÉ•…‘ÕÍÑ½´ ¤ì(€€€½¹ÍÐ¥€ôÁ•¹‘¥¹¥…±½œ¹¥‘ÍlÁtì(€€€™½È€¡½¹ÍÐ¹…µ”½˜=‰©•Ð¹­•åÌ¡‘…Ñ„¤¤ì(€€€€€½¹ÍÐ±…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€±…‰•°¹±…ÍÍ9…µ”€ô€Á±…å±¥ÍÐµ¡½¥”ÕÍÑ½´µÁ±…å±¥ÍÐµ¡½¥”œì(€€€€€½¹ÍÐˆ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€ˆ¹ÑåÁ”€ô€¡•­‰½àœì(€€€€€ˆ¹Ù…±Õ”€ô¹…µ”ì(€€€€€ˆ¹‘…Ñ…Í•Ð¹ÕÍÑ½µA±…å±¥ÍÐ€ô€œÄœì(€€€€€ˆ¹¡•­•€ôÁ•¹‘¥¹¥…±½œ¹µ½‘”€ôôô€Í¥¹±”œ€˜˜€„…¥€˜˜Í…™•%‘Ì¡‘…Ñ…m¹…µ•t¤¹¥¹±Õ‘•Ì¡¥¤ì(€€€€€½¹ÍÐÍÁ…¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€€€ÍÁ…¸¹Ñ•áÑ½¹Ñ•¹Ð€ô¹…µ”ì(€€€€€±…‰•°¹…ÁÁ•¹¡ˆ°ÍÁ…¸¤ì(€€€€€Á±…å±¥ÍÑ¡½¥•Ì¹…ÁÁ•¹‘¡¥±¡±…‰•°¤ì(€€€ô(€ô((€¥˜€¡Á±…å±¥ÍÑ¥…±½œ¤ì(€€€¹•Ü5ÕÑ…Ñ¥½¹=‰Í•ÉÙ•È  ¤€ôøì(€€€€€¥˜€¡Á±…å±¥ÍÑ¥…±½œ¹½Á•¸¤…Õµ•¹ÑA±…å±¥ÍÑ¡½¥•Ì ¤ì(€€€ô¤¹½‰Í•ÉÙ”¡Á±…å±¥ÍÑ¥…±½œ°ì…ÑÑÉ¥‰ÕÑ•ÌèÑÉÕ”°…ÑÑÉ¥‰ÕÑ•¥±Ñ•Èèl½Á•¸tô¤ì(€ô((€Í…Ù•A±…å±¥ÍÑÍ	Ñ¸ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€¥˜€ …Á•¹‘¥¹¥…±½œ¹¥‘Ì¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€½¹ÍÐ‘…Ñ„€ôÉ•…‘ÕÍÑ½´ ¤ì(€€€½¹ÍÐ¡•­•€ô¹•ÜM•Ð¡l¸¸¹Á±…å±¥ÍÑ¡½¥•Ì¹ÅÕ•ÉåM•±•Ñ½É±° ¥¹ÁÕÑm‘…Ñ„µÕÍÑ½´µÁ±…å±¥ÍÐôˆÄ‰té¡•­•œ¥t¹µ…À¡ˆ€ôøˆ¹Ù…±Õ”¤¤ì(€€€™½È€¡½¹ÍÐ¹…µ”½˜=‰©•Ð¹­•åÌ¡‘…Ñ„¤¤ì(€€€€€½¹ÍÐÍ•Ð€ô¹•ÜM•Ð¡Í…™•%‘Ì¡‘…Ñ…m¹…µ•t¤¤ì(€€€€€¥˜€¡Á•¹‘¥¹¥…±½œ¹µ½‘”€ôôô€…‘œ¤ì(€€€€€€€¥˜€¡¡•­•¹¡…Ì¡¹…µ”¤¤Á•¹‘¥¹¥…±½œ¹¥‘Ì¹™½É… ¡¥€ôøÍ•Ð¹…‘¡¥¤¤ì(€€€€€ô•±Í”ì(€€€€€€€½¹ÍÐ¥€ôÁ•¹‘¥¹¥…±½œ¹¥‘ÍlÁtì(€€€€€€€¥˜€¡¡•­•¹¡…Ì¡¹…µ”¤¤Í•Ð¹…‘¡¥¤ì•±Í”Í•Ð¹‘•±•Ñ”¡¥¤ì(€€€€€ô(€€€€€‘…Ñ…m¹…µ•t€ôl¸¸¹Í•Ñtì(€€€ô(€€€ÝÉ¥Ñ•ÕÍÑ½´¡‘…Ñ„¤ì(€€€Á•¹‘¥¹¥…±½œ€ôìµ½‘”è€Í¥¹±”œ°¥‘Ìèmtôì(€ô¤ì((€É•µ½Ù••Ù¥•	Ñ¸ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€¥˜€ …É•µ½Ù••Ù¥•	Ñ¸¹‘¥Í…‰±•¤É•ÑÕÉ¸ì(€€€½¹ÍÐ¥€ôÁ•¹‘¥¹¥…±½œ¹¥‘ÍlÁtñðÑÉ…­1¥ÍÐ¹ÅÕ•ÉåM•±•Ñ½È œ¹ÑÉ…¬µÉ½Ü¹Á±…å¥¹œœ¤ü¹‘…Ñ…Í•Ðü¹¥ñð±…ÍÑA±…å¥¹%ì(€€€¥˜€ …¥¤É•ÑÕÉ¸ì(€€€½¹ÍÐ‘…Ñ„€ôÉ•…‘ÕÍÑ½´ ¤ì(€€€™½È€¡½¹ÍÐ¹…µ”½˜=‰©•Ð¹­•åÌ¡‘…Ñ„¤¤‘…Ñ…m¹…µ•t€ôÍ…™•%‘Ì¡‘…Ñ…m¹…µ•t¤¹™¥±Ñ•È¡ÑÉ…­%€ôøÑÉ…­%€„ôô¥¤ì(€€€ÝÉ¥Ñ•ÕÍÑ½´¡‘…Ñ„¤ì(€ô¤ì((€…Íå¹Œ™Õ¹Ñ¥½¸•áÁ½ÉÑ¹¡…¹•‘	…­ÕÀ¡•Ù•¹Ð¤ì(€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€•Ù•¹Ð¹ÍÑ½Á%µµ•‘¥…Ñ•AÉ½Á……Ñ¥½¸ ¤ì(€€€½¹ÍÐ‰Õ¥±Ñ¥¹Ì€ôÉ•…‘	Õ¥±Ñ¥¹A±…å±¥ÍÑÌ ¤ì(€€€½¹ÍÐÕÍÑ½´€ôÉ•…‘ÕÍÑ½´ ¤ì(€€€½¹ÍÐÁ±…å±¥ÍÑÌ€ôíôì(€€€™½È€¡½¹ÍÐ¹…µ”½˜	U%1Q%9}A1e1%MQL¤Á±…å±¥ÍÑÍm¹…µ•t€ôÍ…™•%‘Ì¡‰Õ¥±Ñ¥¹Ím¹…µ•t¤ì(€€€™½È€¡½¹ÍÐm¹…µ”°¥‘Ít½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡ÕÍÑ½´¤¤Á±…å±¥ÍÑÍm¹…µ•t€ôÍ…™•%‘Ì¡¥‘Ì¤ì(€€€±•Ð™…Ù½É¥Ñ•Ì€ômtì(€€€ÑÉäì™…Ù½É¥Ñ•Ì€ôÍ…™•%‘Ì¡)M=8¹Á…ÉÍ”¡±½…±MÑ½É…”¹•Ñ%Ñ•´¡Y=I%QM}-d¤ñð€mtœ¤¤ìô…Ñ íô(€€€½¹ÍÐÁ…å±½…€ôì(€€€€€…ÁÀè€1•á¤5ÕÍ¥Œœ°(€€€€€Ù•ÉÍ¥½¸è	-UA}YIM%=8°(€€€€€•áÁ½ÉÑ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€Á±…å±¥ÍÑÌ°(€€€€€ÕÍÑ½µA±…å±¥ÍÑ9…µ•Ìè=‰©•Ð¹­•åÌ¡ÕÍÑ½´¤°(€€€€€™…Ù½É¥Ñ•Ì(€€€ôì(€€€½¹ÍÐ™¥±•¹…µ”€ô±•á¤µµÕÍ¥ŒµÁ±…å±¥ÍÑÌ´‘í¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¥ô¹©Í½¹€ì(€€€½¹ÍÐÑ•áÐ€ô)M=8¹ÍÑÉ¥¹¥™ä¡Á…å±½…°¹Õ±°°€È¤ì(€€€½¹ÍÐ™¥±”€ô¹•Ü¥±”¡mÑ•áÑt°™¥±•¹…µ”°ìÑåÁ”è€…ÁÁ±¥…Ñ¥½¸½©Í½¸œô¤ì(€€€ÑÉäì(€€€€€¥˜€¡¹…Ù¥…Ñ½È¹…¹M¡…É”ü¸¡ì™¥±•Ìèm™¥±•tô¤¤ì(€€€€€€€…Ý…¥Ð¹…Ù¥…Ñ½È¹Í¡…É”¡ì™¥±•Ìèm™¥±•t°Ñ¥Ñ±”è€1•á¤5ÕÍ¥ŒÁ±…å±¥ÍÐ‰…­ÕÀœô¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡•ÉÉ½Èü¹¹…µ”€ôôô€‰½ÉÑÉÉ½Èœ¤É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡™¥±”¤ì(€€€½¹ÍÐ„€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð „œ¤ì(€€€„¹¡É•˜€ôÕÉ°ì(€€€„¹‘½Ý¹±½…€ô™¥±•¹…µ”ì(€€€‘½Õµ•¹Ð¹‰½‘ä¹…ÁÁ•¹‘¡¥±¡„¤ì(€€€„¹±¥¬ ¤ì(€€€„¹É•µ½Ù” ¤ì(€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøUI0¹É•Ù½­•=‰©•ÑUI0¡ÕÉ°¤°€ÄÀÀÀ¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸¥µÁ½ÉÑ¹¡…¹•‘	…­ÕÀ¡™¥±”¤ì(€€€¥˜€ …™¥±”¤É•ÑÕÉ¸ì(€€€ÑÉäì(€€€€€½¹ÍÐÁ…ÉÍ•€ô)M=8¹Á…ÉÍ”¡…Ý…¥Ð™¥±”¹Ñ•áÐ ¤¤ì(€€€€€¥˜€ …Á…ÉÍ•ñðÑåÁ•½˜Á…ÉÍ•€„ôô€½‰©•Ðœñð€…Á…ÉÍ•¹Á±…å±¥ÍÑÌ¤Ñ¡É½Ü¹•ÜÉÉ½È Q¡¥Ì¥Ì¹½Ð„1•á¤5ÕÍ¥ŒÁ±…å±¥ÍÐ‰…­ÕÀ¸œ¤ì(€€€€€½¹ÍÐ¥µÁ½ÉÑ•‘	Õ¥±Ñ¥¹Ì€ôíôì(€€€€€™½È€¡½¹ÍÐ¹…µ”½˜	U%1Q%9}A1e1%MQL¤¥µÁ½ÉÑ•‘	Õ¥±Ñ¥¹Ím¹…µ•t€ôÍ…™•%‘Ì¡Á…ÉÍ•¹Á±…å±¥ÍÑÍm¹…µ•t¤ì((€€€€€½¹ÍÐ•áÁ±¥¥Ñ9…µ•Ì€ôÉÉ…ä¹¥ÍÉÉ…ä¡Á…ÉÍ•¹ÕÍÑ½µA±…å±¥ÍÑ9…µ•Ì¤€üÁ…ÉÍ•¹ÕÍÑ½µA±…å±¥ÍÑ9…µ•Ì€èmtì(€€€€€½¹ÍÐ¥¹™•ÉÉ•‘9…µ•Ì€ô=‰©•Ð¹­•åÌ¡Á…ÉÍ•¹Á±…å±¥ÍÑÌ¤¹™¥±Ñ•È¡¹…µ”€ôø€…	U%1Q%9}A1e1%MQL¹¥¹±Õ‘•Ì¡¹…µ”¤¤ì(€€€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ô•áÁ±¥¥Ñ9…µ•Ì¹±•¹Ñ €ü•áÁ±¥¥Ñ9…µ•Ì€è¥¹™•ÉÉ•‘9…µ•Ìì(€€€€€½¹ÍÐ¥µÁ½ÉÑ•‘ÕÍÑ½´€ô=‰©•Ð¹É•…Ñ”¡¹Õ±°¤ì(€€€€€½¹ÍÐÉ•Í•ÉÙ•‘%µÁ½ÉÑ-•åÌ€ô¹•ÜM•Ð¡l10œ°€Y=I%QLœ°€=]91=œ°€¸¸¹	U%1Q%9}A1e1%MQMt¹µ…À¡¹…µ•-•ä¤¤ì(€€€€€™½È€¡½¹ÍÐÉ…Ý9…µ”½˜…¹‘¥‘…Ñ•Ì¤ì(€€€€€€€¥˜€¡ÑåÁ•½˜É…Ý9…µ”€„ôô€ÍÑÉ¥¹œœ¤½¹Ñ¥¹Õ”ì(€€€€€€€½¹ÍÐ¹…µ”€ôÉ…Ý9…µ”¹ÑÉ¥´ ¤ì(€€€€€€€¥˜€ …¹…µ”ñðÉ•Í•ÉÙ•‘%µÁ½ÉÑ-•åÌ¹¡…Ì¡¹…µ•-•ä¡¹…µ”¤¤¤½¹Ñ¥¹Õ”ì(€€€€€€€¥˜€¡=‰©•Ð¹ÁÉ½Ñ½ÑåÁ”¹¡…Í=Ý¹AÉ½Á•ÉÑä¹…±°¡=‰©•Ð¹ÁÉ½Ñ½ÑåÁ”°¹…µ”¤¤½¹Ñ¥¹Õ”ì(€€€€€€€¥µÁ½ÉÑ•‘ÕÍÑ½µm¹…µ•t€ôÍ…™•%‘Ì¡Á…ÉÍ•¹Á±…å±¥ÍÑÍm¹…µ•t¤ì(€€€€€ô(€€€€€½¹ÍÐ¥µÁ½ÉÑ•‘…Ù½É¥Ñ•Ì€ôÍ…™•%‘Ì¡Á…ÉÍ•¹™…Ù½É¥Ñ•Ì¤ì(€€€€€¥˜€ …½¹™¥É´ I•Á±…”Ñ¡”ÕÉÉ•¹ÐÁ±…å±¥ÍÑÌ…¹…Ù½É¥Ñ•ÌÝ¥Ñ Ñ¡¥Ì‰…­ÕÀü½Ý¹±½…‘•Í½¹ÌÝ¥±°¹½Ð‰”¡…¹•¸œ¤¤É•ÑÕÉ¸ì(€€€€€ÝÉ¥Ñ•	Õ¥±Ñ¥¹A±…å±¥ÍÑÌ¡¥µÁ½ÉÑ•‘	Õ¥±Ñ¥¹Ì¤ì(€€€€€ÝÉ¥Ñ•ÕÍÑ½´¡¥µÁ½ÉÑ•‘ÕÍÑ½´¤ì(€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´¡Y=I%QM}-d°)M=8¹ÍÑÉ¥¹¥™ä¡¥µÁ½ÉÑ•‘…Ù½É¥Ñ•Ì¤¤ì(€€€€€Í•ÍÍ¥½¹MÑ½É…”¹Í•Ñ%Ñ•´¡IMQ=I}Y%]}-d°€e4œ¤ì(€€€€€±½…Ñ¥½¸¹É•±½… ¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€…±•ÉÐ¡•ÉÉ½È¹µ•ÍÍ…”ñð€½Õ±¹½Ð¥µÁ½ÉÐÑ¡¥ÌÁ±…å±¥ÍÐ‰…­ÕÀ¸œ¤ì(€€€ô™¥¹…±±äì(€€€€€‰…­ÕÁ¥±•%¹ÁÕÐ¹Ù…±Õ”€ô€œœì(€€€ô(€ô((€•áÁ½ÉÑ	…­ÕÁ	Ñ¸ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°•áÁ½ÉÑ¹¡…¹•‘	…­ÕÀ°ÑÉÕ”¤ì(€¥µÁ½ÉÑ	…­ÕÁ	Ñ¸ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°•Ù•¹Ð€ôøì(€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€•Ù•¹Ð¹ÍÑ½Á%µµ•‘¥…Ñ•AÉ½Á……Ñ¥½¸ ¤ì(€€€‰…­ÕÁ¥±•%¹ÁÕÐü¹±¥¬ ¤ì(€ô°ÑÉÕ”¤ì(€‰…­ÕÁ¥±•%¹ÁÕÐü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°•Ù•¹Ð€ôøì(€€€•Ù•¹Ð¹ÍÑ½Á%µµ•‘¥…Ñ•AÉ½Á……Ñ¥½¸ ¤ì(€€€¥µÁ½ÉÑ¹¡…¹•‘	…­ÕÀ¡‰…­ÕÁ¥±•%¹ÁÕÐ¹™¥±•Ìü¹lÁt¤ì(€ô°ÑÉÕ”¤ì((€¥¹ÍÑ…±±±±•ÍÍ½ÉÌ ¤ì(€É•¹‘•ÉÕÍÑ½µQ…‰Ì ¤ì((€½¹ÍÐÉ•ÍÑ½É”€ôÍ•ÍÍ¥½¹MÑ½É…”¹•Ñ%Ñ•´¡IMQ=I}Y%]}-d¤ì(€¥˜€¡É•ÍÑ½É”¤ì(€€€Í•ÍÍ¥½¹MÑ½É…”¹É•µ½Ù•%Ñ•´¡IMQ=I}Y%]}-d¤ì(€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøÑ…‰Ì¹ÅÕ•ÉåM•±•Ñ½È¡€¹Ñ…‰m‘…Ñ„µÙ¥•Üôˆ‘íML¹•Í…Á”¡É•ÍÑ½É”¥ô‰u€¤ü¹±¥¬ ¤°€ÌÀ¤ì(€ô•±Í”ì(€€€ÕÁ‘…Ñ•!•…‘•É½¹ÑÉ½±Ì ¤ì(€ô)ô¤ ¤ì(