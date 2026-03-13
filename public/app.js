const CONFIG = window.EREN_BINGO_CONFIG || { defaultRoom: 'anaoda', claimTtlMs: 10000 };
const socket = io();
const params = new URLSearchParams(window.location.search);
const mode = document.body.dataset.mode;
const elements = {};
let currentState = null;
let countdownInterval = null;

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
  elements.pendingBox = $('pendingBox');
  elements.pendingActions = $('pendingActions');
  elements.historyList = $('historyList');
  elements.confirmedCount = $('confirmedCount');
  elements.linesCount = $('linesCount');
  elements.bingoBanner = $('bingoBanner');
  elements.modal = $('claimModal');
  elements.modalTitle = $('modalTitle');
  elements.modalText = $('modalText');
  elements.progressBar = $('progressBar');
  elements.modalClose = $('modalClose');
  elements.modalCancel = $('modalCancel');
  elements.resetBtn = $('resetBtn');
  elements.rejectBtn = $('rejectBtn');
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

function joinRoom() {
  const room = cleanRoom(elements.roomInput?.value || params.get('room') || CONFIG.defaultRoom);
  if (elements.roomInput) elements.roomInput.value = room;

  const payload = { room, role: mode };
  if (mode === 'viewer') payload.viewerName = (elements.viewerName?.value || params.get('name') || 'İzleyici').slice(0, 30);
  if (mode === 'host') payload.hostKey = elements.hostKey?.value || params.get('key') || '';
  socket.emit('room:join', payload);
}

function cleanRoom(room) {
  return String(room || CONFIG.defaultRoom).trim().toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 32) || CONFIG.defaultRoom;
}

function onTileClick(tileId) {
  if (!currentState) return;
  if (mode === 'viewer') {
    if (currentState.confirmedTiles.includes(tileId)) return;
    if (currentState.pendingClaim) {
      toast('Şu an başka bir kutu host onayı bekliyor.');
      return;
    }
    socket.emit('claim:create', { tileId });
  } else {
    if (currentState.pendingClaim?.tileId !== tileId) {
      toast('Host sadece bekleyen claim olan kutuyu onaylayabilir.');
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
    button.classList.toggle('viewer-enabled', mode === 'viewer' && !isConfirmed && !state.pendingClaim);
    button.classList.toggle('host-enabled', mode === 'host' && pendingId === tileId && !isConfirmed);
    button.disabled = false;
  });
}

function renderSidebar(state) {
  if (elements.statusBadge) {
    elements.statusBadge.textContent = socket.connected ? 'Bağlı' : 'Bağlantı bekleniyor';
    elements.statusBadge.className = `badge ${socket.connected ? 'ok' : 'warn'}`;
  }
  if (elements.roomCode) elements.roomCode.textContent = state.roomId;
  if (elements.viewerLink) {
    const url = new URL(window.location.origin + '/');
    url.searchParams.set('room', state.roomId);
    elements.viewerLink.textContent = url.toString();
  }
  if (elements.confirmedCount) elements.confirmedCount.textContent = String(state.confirmedTiles.length);
  if (elements.linesCount) elements.linesCount.textContent = String(state.winningLines.length);
  if (elements.bingoBanner) {
    elements.bingoBanner.style.display = state.winningLines.length ? 'block' : 'none';
    elements.bingoBanner.textContent = state.winningLines.length
      ? `BİNGO! Tamamlanan çizgi: ${state.winningLines.length}`
      : '';
  }

  if (elements.pendingBox) {
    if (!state.pendingClaim) {
      elements.pendingBox.innerHTML = '<div class="small">Şu an bekleyen claim yok.</div>';
      if (elements.pendingActions) elements.pendingActions.style.display = 'none';
    } else {
      elements.pendingBox.innerHTML = `
        <div class="stack">
          <div><strong>${escapeHtml(state.pendingClaim.tileLabel)}</strong></div>
          <div class="small">Claim eden: ${escapeHtml(state.pendingClaim.viewerName)}</div>
          <div class="small">Kalan süre: <span id="pendingSeconds">${Math.ceil(state.pendingClaim.remainingMs / 1000)}</span> sn</div>
        </div>
      `;
      if (elements.pendingActions) elements.pendingActions.style.display = mode === 'host' ? 'flex' : 'none';
    }
  }

  if (elements.historyList) {
    elements.historyList.innerHTML = '';
    state.history.slice().reverse().forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = renderHistoryItem(item);
      elements.historyList.appendChild(li);
    });
  }

  syncModal(state);
  startPendingCountdown(state);
}

function renderHistoryItem(item) {
  const map = {
    claim: 'claim gönderdi',
    confirmed: 'host onayladı',
    rejected: 'host reddetti',
    expired: 'süre doldu',
    cancelled: 'claim iptal edildi',
    disconnect: 'bağlantı koptu'
  };
  const time = new Date(item.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `<strong>${escapeHtml(item.tileLabel)}</strong><br>${escapeHtml(item.viewerName || 'Sistem')} · ${escapeHtml(map[item.type] || item.type)}<br><span class="small">${time}</span>`;
}

function syncModal(state) {
  if (mode !== 'viewer' || !elements.modal) return;
  const pending = state.pendingClaim;
  if (!pending) {
    elements.modal.classList.remove('open');
    return;
  }
  elements.modal.classList.add('open');
  elements.modalTitle.textContent = pending.tileLabel;
  elements.modalText.textContent = 'Host onayı bekleniyor. 10 saniye içinde onay gelmezse claim düşer.';
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

function toast(message) {
  console.log(message);
  if (mode === 'viewer' && elements.modal && !elements.modal.classList.contains('open')) {
    elements.modal.classList.add('open');
    elements.modalTitle.textContent = 'Bilgi';
    elements.modalText.textContent = message;
    elements.progressBar.style.transform = 'scaleX(0)';
    setTimeout(() => elements.modal.classList.remove('open'), 1800);
  }
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function bindEvents() {
  elements.joinBtn?.addEventListener('click', joinRoom);
  elements.modalClose?.addEventListener('click', () => elements.modal.classList.remove('open'));
  elements.modalCancel?.addEventListener('click', () => socket.emit('claim:cancel'));
  elements.rejectBtn?.addEventListener('click', () => socket.emit('host:rejectClaim'));
  elements.resetBtn?.addEventListener('click', () => {
    if (confirm('Oda sıfırlansın mı?')) socket.emit('host:resetRoom');
  });
  socket.on('connect', () => {
    if (elements.statusBadge) {
      elements.statusBadge.textContent = 'Bağlı';
      elements.statusBadge.className = 'badge ok';
    }
    joinRoom();
  });
  socket.on('room:state', state => {
    currentState = state;
    updateBoard(state);
    renderSidebar(state);
  });
  socket.on('auth:error', payload => alert(payload.message || 'Host girişi başarısız.'));
  socket.on('claim:error', payload => toast(payload.message || 'İşlem yapılamadı.'));
}

window.addEventListener('DOMContentLoaded', () => {
  setupRefs();
  renderBoard();
  if (elements.roomInput) elements.roomInput.value = cleanRoom(params.get('room') || CONFIG.defaultRoom);
  if (elements.viewerName) elements.viewerName.value = params.get('name') || 'İzleyici';
  bindEvents();
});
