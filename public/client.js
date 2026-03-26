(() => {
  const APP_CONFIG = window.APP_CONFIG || {};
  const PAGE = document.body?.dataset?.page || "viewer";

  const TILES = [
    { id: "t01", label: "Cüce Muhabbeti" },
    { id: "t02", label: "Irkçılık İması" },
    { id: "t03", label: "Ayak Konusu Açıldı" },
    { id: "t04", label: "Siyaset Girdi" },
    { id: "t05", label: "Kavga / Gerginlik" },

    { id: "t06", label: "Aşırı Bağırma" },
    { id: "t07", label: "Chat'e Laf Attı" },
    { id: "t08", label: "Eski Hikâye Tekrar" },
    { id: "t09", label: "Küfür Patladı" },
    { id: "t10", label: "Konudan Koptu" },

    { id: "t11", label: "Manipülatif Cümle" },
    { id: "t12", label: "Bana Ne Tavrı" },
    { id: "t13", label: "Boş Tehdit" },
    { id: "t14", label: "İlginç Fantezi" },
    { id: "t15", label: "Takıntılı Tekrar" },

    { id: "t16", label: "Biriyle Dertleşme" },
    { id: "t17", label: "Kendini Övme" },
    { id: "t18", label: "Bir Şeyi Yanlış Anlama" },
    { id: "t19", label: "Beklenmedik İtiraf" },
    { id: "t20", label: "Abartılı Mağduriyet" },

    { id: "t21", label: "Gündemden Kopuş" },
    { id: "t22", label: "Aynı Şeyi Döndürme" },
    { id: "t23", label: "Chat'e Küstü" },
    { id: "t24", label: "Duygusal Patlama" },
    { id: "t25", label: "Garip Sessizlik" }
  ];

  const TILE_MAP = Object.fromEntries(TILES.map(t => [t.id, t]));
  const TILE_IDS = TILES.map(t => t.id);

  const state = {
    connected: false,
    role: PAGE === "host" ? "controller" : "viewer",
    room: getQueryParam("room") || APP_CONFIG.defaultRoom || "anaoda",
    username: getStored("bingo.viewerName", ""),
    hostKey: getStored("bingo.hostKey", ""),
    roomState: null,
    lastToastTimer: null,
  };

  const socket = window.io({
    transports: ["websocket", "polling"],
  });

  const el = {
    connectionBadge: $("#connectionBadge"),
    hostJoinBadge: $("#hostJoinBadge"),
    viewerJoinBadge: $("#viewerJoinBadge"),

    hostForm: $("#hostForm"),
    hostRoomInput: $("#hostRoomInput"),
    hostKeyInput: $("#hostKeyInput"),
    hostJoinBtn: $("#hostJoinBtn"),
    resetRoomBtn: $("#resetRoomBtn"),
    hostMessage: $("#hostMessage"),
    hostGrid: $("#hostGrid"),
    pendingList: $("#pendingList"),
    statRoom: $("#statRoom"),
    statOnline: $("#statOnline"),
    statViewers: $("#statViewers"),
    statConfirmed: $("#statConfirmed"),

    viewerForm: $("#viewerForm"),
    viewerRoomInput: $("#viewerRoomInput"),
    viewerNameInput: $("#viewerNameInput"),
    viewerJoinBtn: $("#viewerJoinBtn"),
    viewerGrid: $("#viewerGrid"),
    viewerMessage: $("#viewerMessage"),
    viewerStatRoom: $("#viewerStatRoom"),
    viewerStatOnline: $("#viewerStatOnline"),
    viewerStatConfirmed: $("#viewerStatConfirmed"),
    viewerStatLines: $("#viewerStatLines"),
    bingoBtn: $("#bingoBtn"),

    winnersList: $("#winnersList"),
    toast: $("#toast"),
  };

  init();
  setInterval(() => {
    renderPendingList();
  }, 1000);

  function init() {
    if (el.hostRoomInput) el.hostRoomInput.value = state.room;
    if (el.viewerRoomInput) el.viewerRoomInput.value = state.room;
    if (el.viewerNameInput) el.viewerNameInput.value = state.username;
    if (el.hostKeyInput) el.hostKeyInput.value = state.hostKey;

    if (el.hostForm) {
      el.hostForm.addEventListener("submit", onHostJoin);
    }

    if (el.resetRoomBtn) {
      el.resetRoomBtn.addEventListener("click", onResetRoom);
    }

    if (el.viewerForm) {
      el.viewerForm.addEventListener("submit", onViewerJoin);
    }

    if (el.bingoBtn) {
      el.bingoBtn.addEventListener("click", onBingoClaim);
    }

    renderGrid();
    bindSocket();
    renderAll();
  }

  function bindSocket() {
    socket.on("connect", () => {
      state.connected = true;
      updateConnectionBadge();
      maybeAutoSync();
    });

    socket.on("disconnect", () => {
      state.connected = false;
      updateConnectionBadge();
    });

    socket.on("app:meta", (meta) => {
      if (!state.room && meta.defaultRoom) {
        state.room = meta.defaultRoom;
      }
      renderAll();
    });

    socket.on("app:error", (err) => {
      const msg = err?.message || "Bir hata oluştu.";
      setMessage(msg, true);
      showToast(msg);
    });

    socket.on("room:state", (data) => {
      state.roomState = data;
      renderAll();
    });

    socket.on("state", (data) => {
      state.roomState = data;
      renderAll();
    });

    socket.on("syncState", (data) => {
      state.roomState = data;
      renderAll();
    });

    socket.on("claim:created", (claim) => {
      if (PAGE === "viewer" && claim?.username === state.username) {
        showToast(`Talep gönderildi: ${tileLabel(claim.tileId)}`);
      }
      renderAll();
    });

    socket.on("claim:confirmed", (payload) => {
      if (payload?.username && payload.username === state.username) {
        showToast(`Onaylandı: ${tileLabel(payload.tileId)}`);
      }
      requestState();
    });

    socket.on("claim:rejected", (payload) => {
      if (payload?.username && payload.username === state.username) {
        showToast(`Reddedildi: ${tileLabel(payload.tileId)}`);
      }
      requestState();
    });

    socket.on("claim:expired", (payload) => {
      if (payload?.username && payload.username === state.username) {
        showToast(`Süre doldu: ${tileLabel(payload.tileId)}`);
      }
      requestState();
    });

    socket.on("tile:unconfirmed", () => {
      requestState();
    });

    socket.on("room:reset:done", () => {
      showToast("Oda sıfırlandı.");
      requestState();
    });

    socket.on("bingo:ranked", (winner) => {
      if (winner?.username === state.username && PAGE === "viewer") {
        showToast(`Tebrikler, ${winner.rank}. bingo yapan sensin.`);
      }
      requestState();
    });
  }

  async function onHostJoin(e) {
    e.preventDefault();

    const room = normalizeRoom(el.hostRoomInput?.value || state.room || APP_CONFIG.defaultRoom || "anaoda");
    const hostKey = String(el.hostKeyInput?.value || "").trim();

    if (!hostKey) {
      setMessage("Host anahtarı boş olamaz.", true);
      return;
    }

    state.room = room;
    state.hostKey = hostKey;
    setStored("bingo.hostKey", hostKey);

    const res = await emitAck("host:create", {
      room,
      hostKey,
      forceReset: false,
    });

    if (!res?.ok) {
      setMessage(res?.message || "Host bağlantısı kurulamadı.", true);
      return;
    }

    state.role = "controller";
    setMessage(`Host olarak bağlandın: ${room}`, false);
    updateHostJoinBadge(true);
    requestState();
    renderAll();
  }

  async function onResetRoom() {
    if (!state.room) return;
    const hostKey = String(el.hostKeyInput?.value || state.hostKey || "").trim();

    if (!hostKey) {
      setMessage("Önce host anahtarını gir.", true);
      return;
    }

    const res = await emitAck("host:reset", {
      room: state.room,
      hostKey,
    });

    if (!res?.ok) {
      setMessage(res?.message || "Oda sıfırlanamadı.", true);
      return;
    }

    setMessage("Oda sıfırlandı.", false);
    requestState();
  }

  async function onViewerJoin(e) {
    e.preventDefault();

    const room = normalizeRoom(el.viewerRoomInput?.value || state.room || APP_CONFIG.defaultRoom || "anaoda");
    const username = String(el.viewerNameInput?.value || "").trim();

    if (!username) {
      setMessage("İsim boş olamaz.", true);
      return;
    }

    state.room = room;
    state.username = username;
    setStored("bingo.viewerName", username);

    const res = await emitAck("viewer:join", {
      room,
      username,
    });

    if (!res?.ok) {
      setMessage(res?.message || "Odaya katılamadın.", true);
      return;
    }

    state.role = "viewer";
    setMessage(`Odaya katıldın: ${room}`, false);
    updateViewerJoinBadge(true);
    requestState();
    renderAll();
  }

  async function onTileClick(tileId) {
    if (!state.connected) {
      showToast("Bağlantı yok.");
      return;
    }

    if (!state.room) {
      showToast("Önce odaya katıl.");
      return;
    }

    if (PAGE === "viewer") {
      if (!state.username) {
        showToast("Önce ismini girip katıl.");
        return;
      }

      const tileState = getViewerTileState(tileId);
      if (tileState.confirmed || tileState.pendingSelf || tileState.pendingOther) {
        return;
      }

      const res = await emitAck("viewer:claim", {
        room: state.room,
        username: state.username,
        tileId,
      });

      if (!res?.ok) {
        showToast(res?.message || "Talep gönderilemedi.");
        return;
      }

      requestState();
      renderAll();
      return;
    }

    if (PAGE === "host") {
      const tileState = getHostTileState(tileId);
      const hostKey = String(el.hostKeyInput?.value || state.hostKey || "").trim();

      if (!hostKey) {
        showToast("Host anahtarı gerekli.");
        return;
      }

      if (tileState.confirmed) {
        const res = await emitAck("host:unconfirm", {
          room: state.room,
          hostKey,
          tileId,
        });

        if (!res?.ok) {
          showToast(res?.message || "Kutu geri alınamadı.");
          return;
        }

        requestState();
        return;
      }

      const res = await emitAck("host:confirm", {
        room: state.room,
        hostKey,
        tileId,
      });

      if (!res?.ok) {
        showToast(res?.message || "Kutu onaylanamadı.");
        return;
      }

      requestState();
    }
  }

  async function onPendingApprove(tileId) {
    const hostKey = String(el.hostKeyInput?.value || state.hostKey || "").trim();
    const res = await emitAck("host:confirm", { room: state.room, hostKey, tileId });
    if (!res?.ok) {
      showToast(res?.message || "Onay başarısız.");
      return;
    }
    requestState();
  }

  async function onPendingReject(tileId) {
    const hostKey = String(el.hostKeyInput?.value || state.hostKey || "").trim();
    const res = await emitAck("host:reject", { room: state.room, hostKey, tileId });
    if (!res?.ok) {
      showToast(res?.message || "Red başarısız.");
      return;
    }
    requestState();
  }

  async function onBingoClaim() {
    const completedLines = getCompletedLines();
    if (!completedLines.length) {
      showToast("Henüz bingo yok.");
      return;
    }

    const res = await emitAck("viewer:bingo", {
      room: state.room,
      username: state.username,
      lines: completedLines,
    });

    if (!res?.ok) {
      showToast(res?.message || "Bingo bildirilemedi.");
      return;
    }

    showToast(`Bingo bildirildi. Sıra: ${res.rank}`);
    requestState();
  }

  function maybeAutoSync() {
    if (PAGE === "host" && state.room && state.hostKey) {
      updateHostJoinBadge(false);
    }
    if (PAGE === "viewer" && state.room && state.username) {
      updateViewerJoinBadge(false);
    }
    requestState();
  }

  function requestState() {
    if (!state.room) return;
    socket.emit("room:state", { room: state.room }, (res) => {
      if (res?.ok && res.state) {
        state.roomState = res.state;
        renderAll();
      }
    });
  }

  function renderAll() {
    updateConnectionBadge();
    renderGrid();
    renderPendingList();
    renderStats();
    renderWinners();
    updateBingoButton();
    updateJoinBadgesFromState();
  }

  function renderGrid() {
    const container = PAGE === "host" ? el.hostGrid : el.viewerGrid;
    if (!container) return;

    container.innerHTML = "";

    TILES.forEach((tile) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tile";
      btn.dataset.tileId = tile.id;

      let badge = "";
      let meta = "";

      if (PAGE === "viewer") {
        const s = getViewerTileState(tile.id);

        if (s.confirmed) {
          btn.classList.add("confirmed", "locked");
          badge = "ONAY";
          meta = "Host tarafından onaylandı";
        } else if (s.pendingSelf) {
          btn.classList.add("pending-self", "locked");
          badge = "BEKLEME";
          meta = "Sen işaretledin, host bekleniyor";
        } else if (s.pendingOther) {
          btn.classList.add("pending-other", "locked");
          badge = "DOLU";
          meta = `Bekleyen: ${s.pendingOtherBy || "başkası"}`;
        } else {
          meta = "Tıkla ve talep gönder";
        }
      } else {
        const s = getHostTileState(tile.id);

        if (s.confirmed) {
          btn.classList.add("confirmed");
          badge = "AÇIK";
          meta = "Tıklarsan geri alınır";
        } else if (s.pending) {
          btn.classList.add("pending-self");
          badge = "TALEP";
          meta = `${s.pendingBy} bekliyor`;
        } else {
          meta = "Tıklarsan direkt onaylanır";
        }
      }

      btn.innerHTML = `
        ${badge ? `<div class="tile-badge">${escapeHtml(badge)}</div>` : ""}
        <div class="tile-id">${escapeHtml(tile.id.toUpperCase())}</div>
        <div class="tile-label">${escapeHtml(tile.label)}</div>
        <div class="tile-meta">${escapeHtml(meta)}</div>
      `;

      btn.addEventListener("click", () => onTileClick(tile.id));
      container.appendChild(btn);
    });
  }

  function renderPendingList() {
    if (!el.pendingList || PAGE !== "host") return;

    const pending = getPendingClaims();

    if (!pending.length) {
      el.pendingList.className = "pending-list empty-state";
      el.pendingList.textContent = "Bekleyen talep yok.";
      return;
    }

    el.pendingList.className = "pending-list";
    el.pendingList.innerHTML = "";

    pending.forEach((claim) => {
      const item = document.createElement("div");
      item.className = "pending-card";

      const remainMs = Math.max(0, Number(claim.expiresAt || 0) - Date.now());
      const remainSec = Math.ceil(remainMs / 1000);

      item.innerHTML = `
        <div class="pending-head">
          <div>
            <div class="pending-title">${escapeHtml(tileLabel(claim.tileId))}</div>
            <div class="pending-sub">${escapeHtml(claim.username)} talep etti</div>
          </div>
          <div class="badge">${remainSec}s</div>
        </div>
        <div class="pending-sub">Kutu ID: ${escapeHtml(claim.tileId)}</div>
        <div class="pending-actions">
          <button class="btn btn-small btn-approve" data-act="approve">Onayla</button>
          <button class="btn btn-small btn-reject" data-act="reject">Reddet</button>
        </div>
      `;

      item.querySelector('[data-act="approve"]').addEventListener("click", () => {
        onPendingApprove(claim.tileId);
      });

      item.querySelector('[data-act="reject"]').addEventListener("click", () => {
        onPendingReject(claim.tileId);
      });

      el.pendingList.appendChild(item);
    });
  }

  function renderStats() {
    const roomState = state.roomState;
    const confirmedCount = roomState?.confirmedTiles?.length || 0;
    const online = roomState?.onlineCount || 0;
    const viewers = roomState?.viewerCount || 0;
    const room = roomState?.room || state.room || "-";
    const lines = getCompletedLines().length;

    if (el.statRoom) el.statRoom.textContent = room;
    if (el.statOnline) el.statOnline.textContent = String(online);
    if (el.statViewers) el.statViewers.textContent = String(viewers);
    if (el.statConfirmed) el.statConfirmed.textContent = String(confirmedCount);

    if (el.viewerStatRoom) el.viewerStatRoom.textContent = room;
    if (el.viewerStatOnline) el.viewerStatOnline.textContent = String(online);
    if (el.viewerStatConfirmed) el.viewerStatConfirmed.textContent = String(confirmedCount);
    if (el.viewerStatLines) el.viewerStatLines.textContent = String(lines);
  }

  function renderWinners() {
    if (!el.winnersList) return;

    const winners = state.roomState?.winners || [];
    if (!winners.length) {
      el.winnersList.className = "winners-list empty-state";
      el.winnersList.textContent = "Henüz bingo yok.";
      return;
    }

    el.winnersList.className = "winners-list";
    el.winnersList.innerHTML = "";

    winners.forEach((winner) => {
      const card = document.createElement("div");
      card.className = "winner-card";
      card.innerHTML = `
        <div class="winner-rank">#${escapeHtml(String(winner.rank))}</div>
        <div class="winner-main">
          <div class="winner-name">${escapeHtml(winner.username)}</div>
          <div class="winner-sub">${escapeHtml(formatLines(winner.lines))}</div>
        </div>
      `;
      el.winnersList.appendChild(card);
    });
  }

  function updateBingoButton() {
    if (!el.bingoBtn) return;
    const lineCount = getCompletedLines().length;
    el.bingoBtn.disabled = !(state.username && state.room && lineCount > 0);
  }

  function updateConnectionBadge() {
    if (!el.connectionBadge) return;

    if (state.connected) {
      el.connectionBadge.textContent = "Socket bağlı";
      el.connectionBadge.className = "badge badge-online";
    } else {
      el.connectionBadge.textContent = "Socket kopuk";
      el.connectionBadge.className = "badge badge-offline";
    }
  }

  function updateJoinBadgesFromState() {
    const joined = !!state.roomState?.room;

    if (PAGE === "host") {
      updateHostJoinBadge(joined && state.role === "controller");
    } else {
      const viewerJoined = joined && !!state.username;
      updateViewerJoinBadge(viewerJoined);
    }
  }

  function updateHostJoinBadge(ok) {
    if (!el.hostJoinBadge) return;
    el.hostJoinBadge.textContent = ok ? "Host bağlı" : "Bağlı değil";
    el.hostJoinBadge.className = ok ? "badge badge-good" : "badge";
    if (el.hostJoinBtn) {
      el.hostJoinBtn.textContent = ok ? "Bağlandı ✓" : "Odayı Aç / Bağlan";
    }
  }

  function updateViewerJoinBadge(ok) {
    if (!el.viewerJoinBadge) return;
    el.viewerJoinBadge.textContent = ok ? "Odaya katıldın" : "Katılmadın";
    el.viewerJoinBadge.className = ok ? "badge badge-good" : "badge";
    if (el.viewerJoinBtn) {
      el.viewerJoinBtn.textContent = ok ? "Katıldın ✓" : "Katıl";
    }
  }

  function getPendingClaims() {
    return [...(state.roomState?.pendingClaims || [])].sort((a, b) => {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function getConfirmedSet() {
    return new Set(state.roomState?.confirmedTiles || []);
  }

  function getViewerTileState(tileId) {
    const confirmed = getConfirmedSet().has(tileId);
    const pendingClaims = getPendingClaims();
    const pending = pendingClaims.find(p => p.tileId === tileId);

    return {
      confirmed,
      pendingSelf: !confirmed && !!pending && pending.username === state.username,
      pendingOther: !confirmed && !!pending && pending.username !== state.username,
      pendingOtherBy: pending?.username || "",
    };
  }

  function getHostTileState(tileId) {
    const confirmed = getConfirmedSet().has(tileId);
    const pending = getPendingClaims().find(p => p.tileId === tileId);

    return {
      confirmed,
      pending: !!pending,
      pendingBy: pending?.username || "",
    };
  }

  function getCompletedLines() {
    const set = getConfirmedSet();
    const lines = [];

    const grid = [
      ["t01","t02","t03","t04","t05"],
      ["t06","t07","t08","t09","t10"],
      ["t11","t12","t13","t14","t15"],
      ["t16","t17","t18","t19","t20"],
      ["t21","t22","t23","t24","t25"],
    ];

    grid.forEach((row, i) => {
      if (row.every(id => set.has(id))) {
        lines.push(`Satır ${i + 1}`);
      }
    });

    for (let col = 0; col < 5; col++) {
      const ids = [grid[0][col], grid[1][col], grid[2][col], grid[3][col], grid[4][col]];
      if (ids.every(id => set.has(id))) {
        lines.push(`Kolon ${col + 1}`);
      }
    }

    const d1 = [grid[0][0], grid[1][1], grid[2][2], grid[3][3], grid[4][4]];
    const d2 = [grid[0][4], grid[1][3], grid[2][2], grid[3][1], grid[4][0]];

    if (d1.every(id => set.has(id))) lines.push("Çapraz 1");
    if (d2.every(id => set.has(id))) lines.push("Çapraz 2");

    return lines;
  }

  function setMessage(text, isError) {
    const target = PAGE === "host" ? el.hostMessage : el.viewerMessage;
    if (!target) return;
    target.textContent = text || "";
    target.className = `message ${text ? (isError ? "is-error" : "is-ok") : ""}`.trim();
  }

  function showToast(text) {
    if (!el.toast) return;
    clearTimeout(state.lastToastTimer);
    el.toast.textContent = text;
    el.toast.classList.add("show");

    state.lastToastTimer = setTimeout(() => {
      el.toast.classList.remove("show");
    }, 2400);
  }

  function emitAck(eventName, payload) {
    return new Promise((resolve) => {
      socket.emit(eventName, payload, (res) => {
        resolve(res || { ok: false, message: "Yanıt alınamadı." });
      });
    });
  }

  function tileLabel(tileId) {
    return TILE_MAP[tileId]?.label || tileId;
  }

  function formatLines(lines) {
    if (!Array.isArray(lines) || !lines.length) return "Bingo yaptı";
    return lines.join(", ");
  }

  function normalizeRoom(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 50) || "anaoda";
  }

  function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name) || "";
  }

  function setStored(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  function getStored(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function $(selector) {
    return document.querySelector(selector);
  }
})();
