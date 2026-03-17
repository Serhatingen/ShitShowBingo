const CONFIG = window.EREN_BINGO_CONFIG || { defaultRoom: 'anaoda', claimTtlMs: 10000 };
const socket = io();
const params = new URLSearchParams(window.location.search);
const mode = document.body.dataset.mode;
const elements = {};
let currentState = null;
let countdownInterval = null;
let modalAutoClose = null;
let lastJoinPayload = null;
let roomJoined = false;
let myLatestRank = null;
let spotlightTimeout = null;
let lastSeenHostSpotlightRank = 0;
let lastSeenViewerSpotlightRank = 0;
let heartbeatInterval = null;

const NAME_STORAGE_KEY = 'erenBingoViewerName';
const ROOM_STORAGE_KEY = 'erenBingoRoom';

const TILE_ORDER = [
  ['iliskitavsiyesi-r1c1', 'gaf-r1c2', 'eyt-r1c3', 'dusmanlarivar-r1c4', 'irkcilik-r1c5'],
  ['fb-r2c1', 'cillik-r2c2', 'erkekkotuleme-r2c3', 'nolan-r2c4', 'gs-r2c5'],
  ['drama-r3c1', 'cuce-r3c2', 'zengin-r3c3', 'dul-r3c4', 'ayaj-r3c5']
];

const TILE_META = {
  'iliskitavsiyesi-r1c1': { normal: 'images/iliskitavsiyesi-r1c1.gif', selected: 'images/iliskitavsiyesi-r1c1-sh.gif' },
  'gaf-r1c2': { normal: 'images/gaf-r1c2.gif', selected: 'images/gaf-r1c2-sh.gif' },
  'eyt-r1c3': { normal: 'images/eyt-r1c3.gif', selected: 'images/eyt-r1c3-sh.gif' },
  'dusmanlarivar-r1c4': { normal: 'images/dusmanlarivar-r1c4.gif', selected: 'images/dusmanlarivar-r1c4-sh.gif' },
  'irkcilik-r1c5': { normal: 'images/irkcilik-r1c5.gif', selected: 'images/irkcilik-r1c5-sh.gif' },
  'fb-r2c1': { normal: 'images/fb-r2c1.gif', selected: 'images/fb-r2c1-sh.gif' },
  'cillik-r2c2': { normal: 'images/cillik-r2c2.gif', selected: 'images/cillik-r2c2-sh.gif' },
  'erkekkotuleme-r2c3': { normal: 'images/erkekkotuleme-r2c3.gif', selected: 'images/erkekkotuleme-r2c3-sh.gif' },
  'nolan-r2c4': { normal: 'images/nolan-r2c4.gif', selected: 'images/nolan-r2c4-sh.gif' },
  'gs-r2c5': { normal: 'images/gs-r2c5.gif', selected: 'images/gs-r2c5-sh.gif' },
  'drama-r3c1': { normal: 'images/drama-r3c1.gif', selected: 'images/drama-r3c1-sh.png' },
  'cuce-r3c2': { normal: 'images/cuce-r3c2.gif', selected: 'images/cuce-r3c2-sh.gif' },
  'zengin-r3c3': { normal: 'images/zengin-r3c3.gif', selected: 'images/zengin-r3c3-sh.gif' },
  'dul-r3c4': { normal: 'images/dul-r3c4.gif', selected: 'images/dul-r3c4-sh.gif' },
  'ayaj-r3c5': { normal: 'images/ayaj-r3c5.jpg', selected: 'images/ayaj-r3c5-sh.jpg' }
};

function $(id) { return document.getElementById(id); }

function setupRefs() {
  elements.board = $('boardGrid');
  elements.roomInput = $('roomInput');
  elements.viewerName = $('viewerName');
  elements.hostKey = $('hostKey');
  elements.joinBtn = $('joinBtn');
  elements.statusBadge = $('statusBadge');
  elements.roomCode = $('roomCode');
  elements.viewerLink = $('viewerLink');
  elements.copyLinkBtn = $('copyLinkBtn');
  elements.copyHint = $('copyHint');
  elements.pendingBox = $('pendingBox');
  elements.historyList = $('historyList');
  elements.confirmedCount = $('confirmedCount');
  elements.linesCount = $('linesCount');
  elements.bingoBanner = $('bingoBanner');
  elements.bingoList = $('bingoList');
  elements.firstBingoHero = $('firstBingoHero');
  elements.myRankBox = $('myRankBox');
  elements.modal = $('claimModal');
  elements.modalTitle = $('modalTitle');
  elements.modalText = $('modalText');
  elements.progressBar = $('progressBar');
  elements.modalClose = $('modalClose');
  elements.modalCancel = $('modalCancel');
  elements.resetBtn = $('resetBtn');
  elements.rejectBtn = $('rejectBtn');
  elements.spotlightOverlay = $('spotlightOverlay');
  elements.spotlightTitle = $('spotlightTitle');
  elements.spotlightSubtitle = $('spotlightSubtitle');
  elements.spotlightMeta = $('spotlightMeta');
  elements.spotlightConfetti = $('spotlightConfetti');
}


function renderBoard() {
  const board = elements.board;
  board.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'header-tile';
  header.style.gridColumn = '1 / span 5';
  const headerImg = document.createElement('img');
  headerImg.src = 'images/BingoHeader.gif';
  headerImg.alt = 'Bingo Header';
  header.appendChild(headerImg);
  board.appendChild(header);

  TILE_ORDER.flat().forEach(tileId => {
    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.type = 'button';
    tile.dataset.tileId = tileId;
    const img = document.createElement('img');
    img.alt = tileId;
    tile.appendChild(img);
    tile.addEventListener('click', () => onTileClick(tileId));
    board.appendChild(tile);
  });
}

function cleanRoom(room) {
  return String(room || CONFIG.defaultRoom).trim().toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 32) || CONFIG.defaultRoom;
}

function getViewerName() {
  return String(elements.viewerName?.value || '').trim().slice(0, 30);
}

function joinRoom() {
  const room = cleanRoom(elements.roomInput?.value || params.get('room') || CONFIG.defaultRoom);
  if (elements.roomInput) elements.roomInput.value = room;

  const payload = { room, role: mode };

  if (mode === 'viewer') {
    const viewerName = getViewerName();
    if (!viewerName) {
      toast('Kullanıcı adı boş olamaz. Kick kullanıcı adınla aynı yazman en iyisi.');
      elements.viewerName?.focus();
      return;
    }
    payload.viewerName = viewerName;
    localStorage.setItem(NAME_STORAGE_KEY, viewerName);
  }

  if (mode === 'host') {
    const hostKey = (elements.hostKey?.value || params.get('key') || '').trim();
    if (!hostKey) {
      alert('Bu oturum için host anahtarı belirlemelisin.');
      elements.hostKey?.focus();
      return;
    }
    payload.hostKey = hostKey;
  }

  localStorage.setItem(ROOM_STORAGE_KEY, room);
  lastJoinPayload = payload;
  socket.emit('room:join', payload);
}


function updateCopyLinkUi() {
  if (!elements.copyLinkBtn) return;
  const hasViewerLink = Boolean(roomJoined && elements.viewerLink && elements.viewerLink.textContent && elements.viewerLink.textContent !== '-');
  elements.copyLinkBtn.disabled = !hasViewerLink;
  elements.copyLinkBtn.classList.toggle('online', hasViewerLink);
  elements.copyLinkBtn.textContent = hasViewerLink ? 'Linki kopyala' : 'Link hazır değil';
  if (elements.copyHint) {
    elements.copyHint.textContent = hasViewerLink
      ? 'Bu linki yayın chatine atabilirsin. Host anahtarı bu linkte görünmez.'
      : 'Önce bingo linkini oluştur. Sonra tek dokunuşla kopyalarsın.';
  }
}

async function copyViewerLink() {
  const text = elements.viewerLink?.textContent?.trim();
  if (!roomJoined || !text || text === '-') {
    toast('Önce bingo linkini oluşturman lazım.');
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'absolute';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }

    if (elements.copyLinkBtn) {
      const oldText = elements.copyLinkBtn.textContent;
      elements.copyLinkBtn.textContent = 'Link kopyalandı';
      elements.copyLinkBtn.classList.add('online');
      setTimeout(() => {
        if (elements.copyLinkBtn) elements.copyLinkBtn.textContent = oldText;
        updateCopyLinkUi();
      }, 1800);
    }
    if (elements.copyHint) elements.copyHint.textContent = 'İzleyici linki panoya kopyalandı. Chatte direkt yapıştırabilirsin.';
  } catch (err) {
    console.error(err);
    toast('Link kopyalanamadı. Uzun basıp elle kopyalayabilirsin.');
  }
}
function getIdleStatusText() {
  return mode === 'host' ? 'Henüz oda oluşturulmadı' : 'Henüz odaya bağlanılmadı';
}

function updateJoinButton(isOnline) {
  if (!elements.joinBtn) return;
  if (isOnline) {
    elements.joinBtn.textContent = mode === 'host' ? 'Bingo bağlı' : 'Odaya bağlanıldı (Online)';
    elements.joinBtn.classList.add('online');
  } else {
    elements.joinBtn.textContent = mode === 'host' ? 'Odayı oluştur' : 'Odaya bağlan';
    elements.joinBtn.classList.remove('online');
  }
}

function onTileClick(tileId) {
  if (!currentState || !roomJoined) return;
  if (mode === 'viewer') {
    if (currentState.confirmedTiles.includes(tileId)) return;
    if (currentState.pendingClaim) {
      toast('Şu an başka bir kutu host onayı bekliyor. Burası tek şeritli bir yayın otobanı.');
      return;
    }
    socket.emit('claim:create', { tileId });
  } else {
    if (currentState.pendingClaim?.tileId !== tileId) {
      toast('Host sadece bekleyen claim olan kutuyu onaylayabilir. Rastgele kutsama yok.');
      return;
    }
    socket.emit('host:confirmTile', { tileId });
  }
}

function updateBoard(state) {
  const pendingId = state.pendingClaim?.tileId;
  const confirmedSet = new Set(state.confirmedTiles);
  document.querySelectorAll('.tile').forEach(button => {
    const tileId = button.dataset.tileId;
    const img = button.querySelector('img');
    const isConfirmed = confirmedSet.has(tileId);
    const isPending = pendingId === tileId;
    img.src = isConfirmed ? TILE_META[tileId].selected : TILE_META[tileId].normal;
    button.classList.toggle('confirmed', isConfirmed);
    button.classList.toggle('pending', isPending && !isConfirmed);
    button.classList.toggle('viewer-enabled', mode === 'viewer' && roomJoined && !isConfirmed && !state.pendingClaim);
    button.classList.toggle('host-enabled', mode === 'host' && roomJoined && pendingId === tileId && !isConfirmed);
    button.disabled = false;
  });
}

function renderSidebar(state) {
  if (elements.statusBadge) {
    if (socket.connected) {
      elements.statusBadge.textContent = roomJoined ? 'Sunucu bağlı · oda aktif' : getIdleStatusText();
      elements.statusBadge.className = `badge ${roomJoined ? 'ok' : 'warn'}`;
    } else {
      elements.statusBadge.textContent = 'Sunucu bağlantısı koptu';
      elements.statusBadge.className = 'badge danger';
    }
  }
  if (elements.roomCode) elements.roomCode.textContent = state.roomId;
  if (elements.viewerLink) {
    const url = new URL(window.location.origin + '/');
    url.searchParams.set('room', state.roomId);
    elements.viewerLink.textContent = roomJoined ? url.toString() : '-';
  }
  updateCopyLinkUi();
  if (elements.confirmedCount) elements.confirmedCount.textContent = String(state.confirmedTiles.length);
  if (elements.linesCount) elements.linesCount.textContent = String(state.winningLines.length);
  if (elements.bingoBanner) {
    elements.bingoBanner.style.display = state.winningLines.length ? 'block' : 'none';
    elements.bingoBanner.textContent = state.winningLines.length
      ? `BİNGO ÇİZGİSİ: ${state.winningLines.length}`
      : '';
  }

  renderPending(state);
  renderHistory(state.history || []);
  renderBingoList(state.bingoEvents || []);
  renderFirstBingoHero(state.bingoEvents || []);
  renderRadar(state.radar || null);
  syncMyRank(state.bingoEvents || []);
  syncModal(state);
  startPendingCountdown(state);
}

function renderPending(state) {
  if (!elements.pendingBox) return;
  if (!state.pendingClaim) {
    elements.pendingBox.innerHTML = '<div class="small">Şu an bekleyen claim yok.</div>';
    return;
  }

  const pending = state.pendingClaim;
  elements.pendingBox.innerHTML = `
    <div class="stack">
      <div><strong>${escapeHtml(pending.tileLabel)}</strong></div>
      <div class="small">Claim eden: ${escapeHtml(pending.viewerName)}</div>
      <div class="small">Kalan süre: <span id="pendingSeconds">${Math.ceil(pending.remainingMs / 1000)}</span> sn</div>
    </div>
  `;
}

function renderHistory(history) {
  if (!elements.historyList) return;
  elements.historyList.innerHTML = '';
  history.slice().reverse().forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = renderHistoryItem(item);
    elements.historyList.appendChild(li);
  });
}

function renderHistoryItem(item) {
  const map = {
    claim: 'claim gönderdi',
    confirmed: 'host onayladı',
    rejected: 'host reddetti',
    expired: 'süre doldu',
    cancelled: 'claim iptal edildi',
    disconnect: 'bağlantı koptu',
    bingo: `#${item.rank} bingo yaptı`
  };
  const time = formatClock(item.at);
  return `<strong>${escapeHtml(item.tileLabel)}</strong><br>${escapeHtml(item.viewerName || 'Sistem')} · ${escapeHtml(map[item.type] || item.type)}<br><span class="small">${time}</span>`;
}

function renderBingoList(bingoEvents) {
  if (!elements.bingoList) return;
  if (!bingoEvents.length) {
    elements.bingoList.innerHTML = '<li class="empty-list">Henüz bingo sıralaması oluşmadı.</li>';
    return;
  }
  elements.bingoList.innerHTML = '';
  bingoEvents.forEach(event => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="rank-pill">#${event.rank}</span>
      <div>
        <strong>${escapeHtml(event.viewerName)}</strong><br>
        <span class="small">${escapeHtml(event.tileLabel)} ile bingo anı · ${formatClock(event.at)}</span>
      </div>
    `;
    elements.bingoList.appendChild(li);
  });
}

function renderFirstBingoHero(bingoEvents) {
  if (!elements.firstBingoHero) return;
  const first = bingoEvents[0];
  if (!first) {
    elements.firstBingoHero.className = 'hero-card empty';
    elements.firstBingoHero.textContent = 'Henüz ilk bingo düşmedi. Evren tetikte bekliyor.';
    return;
  }
  elements.firstBingoHero.className = 'hero-card';
  elements.firstBingoHero.innerHTML = `
    <div class="hero-title">İlk bingo yapan</div>
    <div class="hero-name">${escapeHtml(first.viewerName)}</div>
    <div class="small">${escapeHtml(first.tileLabel)} ile · ${formatClock(first.at)}</div>
  `;
}

function syncMyRank(bingoEvents) {
  if (mode !== 'viewer' || !elements.myRankBox) return;
  const myName = getViewerName();
  const latestMine = bingoEvents.filter(event => event.viewerName === myName).at(-1) || null;
  const rank = myLatestRank || latestMine;
  if (!rank) {
    elements.myRankBox.style.display = 'none';
    return;
  }
  elements.myRankBox.style.display = 'block';
  elements.myRankBox.textContent = `Şu ana kadarki bingo sıran: #${rank.rank} · ${formatClock(rank.at)}`;
}

function syncSpotlightsFromState(state) {
  const events = state?.bingoEvents || [];
  if (!events.length) return;

  if (mode === 'host') {
    const unseen = events.filter(event => event.rank <= 3 && event.rank > lastSeenHostSpotlightRank);
    if (unseen.length) {
      const latest = unseen[unseen.length - 1];
      lastSeenHostSpotlightRank = latest.rank;
      triggerSpotlight(latest, { viewerMode: false });
    }
    return;
  }

  const myName = getViewerName();
  if (!myName) return;
  const unseenMine = events.filter(event => event.viewerName === myName && event.rank <= 3 && event.rank > lastSeenViewerSpotlightRank);
  if (unseenMine.length) {
    const latest = unseenMine[unseenMine.length - 1];
    lastSeenViewerSpotlightRank = latest.rank;
    triggerSpotlight(latest, { viewerMode: true });
  }
}

function startHeartbeat() {
  clearInterval(heartbeatInterval);
  if (!roomJoined) return;
  heartbeatInterval = setInterval(() => {
    if (socket.connected && roomJoined) socket.emit('heartbeat');
  }, 240000);
}


function renderRadar(radar) {
  if (!elements.radarOnline) return;
  const data = radar || { onlineViewers: 0, totalClaims: 0, oneAwayLines: [], hotTiles: [] };
  elements.radarOnline.textContent = String(data.onlineViewers || 0);
  elements.radarClaims.textContent = String(data.totalClaims || 0);
  elements.radarOneAway.textContent = String((data.oneAwayLines || []).length);

  if (elements.radarHotTiles) {
    const hotTiles = data.hotTiles || [];
    elements.radarHotTiles.innerHTML = hotTiles.length
      ? hotTiles.map(item => `<li><strong>${escapeHtml(item.label)}</strong><span>${item.count} claim${item.confirmed ? ' · onaylı' : ''}</span></li>`).join('')
      : '<li class="empty-list">Henüz yeterli veri yok.</li>';
  }

  if (elements.radarNearLines) {
    const nearLines = data.oneAwayLines || [];
    elements.radarNearLines.innerHTML = nearLines.length
      ? nearLines.map(item => `<li><strong>${escapeHtml(item.missingLabel)}</strong><span>Eksik kutu · ${escapeHtml(item.lineLabels.join(' · '))}</span></li>`).join('')
      : '<li class="empty-list">Şimdilik hiçbir çizgi tek kutu uzakta değil.</li>';
  }
}

function syncModal(state) {
  if (mode !== 'viewer' || !elements.modal) return;
  const pending = state.pendingClaim;
  const myName = getViewerName();
  if (!pending || pending.viewerName !== myName) {
    if (elements.modal.dataset.kind === 'pending') elements.modal.classList.remove('open');
    return;
  }

  elements.modal.dataset.kind = 'pending';
  elements.modal.classList.add('open');
  elements.modalTitle.textContent = pending.tileLabel;
  elements.modalText.textContent = 'Host onayı bekleniyor. 10 saniye içinde onay gelmezse claim düşer.';
  elements.modalCancel.style.display = 'inline-flex';
  elements.progressBar.style.transform = 'scaleX(1)';
}

function startPendingCountdown(state) {
  clearInterval(countdownInterval);
  countdownInterval = null;
  if (!state.pendingClaim) return;

  const startedAt = Date.now();
  const initialMs = state.pendingClaim.remainingMs;
  countdownInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, initialMs - elapsed);
    const secondsEl = $('pendingSeconds');
    if (secondsEl) secondsEl.textContent = String(Math.ceil(remaining / 1000));
    if (elements.progressBar) {
      elements.progressBar.style.transform = `scaleX(${remaining / initialMs || 0})`;
    }
    if (!remaining) clearInterval(countdownInterval);
  }, 100);
}

function rankText(rank) {
  const map = { 1: '1.', 2: '2.', 3: '3.' };
  return map[rank] || `${rank}.`;
}

function triggerSpotlight(event, { viewerMode = false } = {}) {
  if (!elements.spotlightOverlay || !event) return;
  clearTimeout(spotlightTimeout);

  const isTop3 = event.rank <= 3;
  const title = viewerMode
    ? (isTop3 ? `TEBRİKLER! ${rankText(event.rank)} BİNGO SENSİN` : `${rankText(event.rank)} BİNGO YAPAN SENSİN`)
    : (isTop3 ? `İLK ${event.rank} TAMAMLANDI` : `YENİ BİNGO`);
  const subtitle = viewerMode
    ? event.viewerName
    : `#${event.rank} · ${event.viewerName}`;
  const meta = `${event.tileLabel} · ${formatClock(event.at)}`;

  elements.spotlightTitle.textContent = title;
  elements.spotlightSubtitle.textContent = subtitle;
  elements.spotlightMeta.textContent = meta;
  elements.spotlightOverlay.classList.add('open');
  elements.spotlightOverlay.classList.toggle('top3', isTop3);

  if (elements.spotlightConfetti) {
    elements.spotlightConfetti.innerHTML = '';
    if (viewerMode && isTop3) {
      for (let i = 0; i < 40; i += 1) {
        const piece = document.createElement('span');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.animationDelay = `${Math.random() * 0.6}s`;
        piece.style.animationDuration = `${2.2 + Math.random() * 1.4}s`;
        piece.style.transform = `translateY(-20px) rotate(${Math.random() * 360}deg)`;
        elements.spotlightConfetti.appendChild(piece);
      }
    }
  }

  spotlightTimeout = setTimeout(() => {
    elements.spotlightOverlay.classList.remove('open');
    elements.spotlightOverlay.classList.remove('top3');
  }, viewerMode && isTop3 ? 5200 : 3600);
}

function openInfoModal(title, text, { autoClose = 2200 } = {}) {
  if (!elements.modal) return;
  clearTimeout(modalAutoClose);
  elements.modal.dataset.kind = 'info';
  elements.modal.classList.add('open');
  elements.modalTitle.textContent = title;
  elements.modalText.textContent = text;
  elements.modalCancel.style.display = 'none';
  elements.progressBar.style.transform = 'scaleX(0)';
  if (autoClose) {
    modalAutoClose = setTimeout(() => elements.modal.classList.remove('open'), autoClose);
  }
}

function toast(message) {
  console.log(message);
  if (mode === 'viewer') openInfoModal('Bilgi', message, { autoClose: 2200 });
}

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function bindEvents() {
  elements.joinBtn?.addEventListener('click', joinRoom);
  elements.copyLinkBtn?.addEventListener('click', copyViewerLink);
  elements.modalClose?.addEventListener('click', () => elements.modal.classList.remove('open'));
  elements.modalCancel?.addEventListener('click', () => socket.emit('claim:cancel'));
  elements.rejectBtn?.addEventListener('click', () => socket.emit('host:rejectClaim'));
  elements.resetBtn?.addEventListener('click', () => {
    if (confirm('Oda sıfırlansın mı?')) socket.emit('host:resetRoom');
  });

  socket.on('connect', () => {
    if (elements.statusBadge) {
      elements.statusBadge.textContent = roomJoined ? 'Sunucu bağlı · yeniden bağlanıyor' : getIdleStatusText();
      elements.statusBadge.className = `badge ${roomJoined ? 'warn' : 'warn'}`;
    }
    if (lastJoinPayload) socket.emit('room:join', lastJoinPayload);
  });

  socket.on('disconnect', () => {
    roomJoined = false;
    clearInterval(heartbeatInterval);
    updateJoinButton(false);
  updateCopyLinkUi();
    if (elements.statusBadge) {
      elements.statusBadge.textContent = 'Sunucu bağlantısı koptu';
      elements.statusBadge.className = 'badge danger';
    }
  });

  socket.on('room:joined', payload => {
    roomJoined = true;
    startHeartbeat();
    updateJoinButton(true);
    if (mode === 'viewer' && payload.viewerName && elements.viewerName) {
      elements.viewerName.value = payload.viewerName;
    }
    if (elements.roomCode) elements.roomCode.textContent = payload.roomId;
    if (elements.statusBadge) {
      elements.statusBadge.textContent = 'Sunucu bağlı · oda aktif';
      elements.statusBadge.className = 'badge ok';
    }
  });

  socket.on('room:state', state => {
    currentState = state;
    updateBoard(state);
    renderSidebar(state);
    syncSpotlightsFromState(state);
  });

  socket.on('viewer:bingoRank', event => {
    myLatestRank = event;
    if (event.rank <= 3) lastSeenViewerSpotlightRank = Math.max(lastSeenViewerSpotlightRank, event.rank);
    if (event.rank <= 3) {
      triggerSpotlight(event, { viewerMode: true });
    } else {
      openInfoModal('Bingo!', `Tebrikler, ${event.rank}. bingo yapan sensin. Saat: ${formatClock(event.at)}`, { autoClose: 4200 });
    }
    syncMyRank(currentState?.bingoEvents || []);
  });

  socket.on('room:bingoEvent', event => {
    if (mode === 'host' && event.rank <= 3) {
      lastSeenHostSpotlightRank = Math.max(lastSeenHostSpotlightRank, event.rank);
      triggerSpotlight(event, { viewerMode: false });
    }
  });

  socket.on('auth:error', payload => {
    roomJoined = false;
    clearInterval(heartbeatInterval);
    updateJoinButton(false);
  updateCopyLinkUi();
    alert(payload.message || 'Host girişi başarısız.');
  });

  socket.on('join:error', payload => {
    roomJoined = false;
    clearInterval(heartbeatInterval);
    updateJoinButton(false);
  updateCopyLinkUi();
    toast(payload.message || 'Odaya girilemedi.');
  });

  socket.on('claim:error', payload => toast(payload.message || 'İşlem yapılamadı.'));
}

window.addEventListener('DOMContentLoaded', () => {
  setupRefs();
  renderBoard();

  const savedRoom = localStorage.getItem(ROOM_STORAGE_KEY);
  const savedName = localStorage.getItem(NAME_STORAGE_KEY);

  if (elements.roomInput) elements.roomInput.value = cleanRoom(params.get('room') || savedRoom || CONFIG.defaultRoom);
  if (elements.viewerName) elements.viewerName.value = (params.get('name') || savedName || '').slice(0, 30);
  if (elements.hostKey && params.get('key')) elements.hostKey.value = params.get('key');
  if (mode === 'host' && elements.roomInput && !params.get('room') && !savedRoom) elements.roomInput.placeholder = 'oturum-adi';

  updateJoinButton(false);
  updateCopyLinkUi();
  if (elements.statusBadge) {
    elements.statusBadge.textContent = getIdleStatusText();
    elements.statusBadge.className = 'badge warn';
  }

  bindEvents();
});
