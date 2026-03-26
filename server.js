import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_ROOM = normalizeRoom(process.env.DEFAULT_ROOM || "anaoda");
const CLAIM_TTL_MS = Math.max(3000, Number(process.env.CLAIM_TTL_MS) || 10000);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});

const PUBLIC_DIR = path.join(__dirname, "public");
const ROOM_PREFIX = "room:";

/**
 * rooms:
 * roomName -> {
 *   name,
 *   createdAt,
 *   hostKey,
 *   controllers: Set<socketId>,
 *   viewers: Map<socketId, { username, joinedAt }>,
 *   socketRoles: Map<socketId, "viewer" | "controller">,
 *   confirmedTiles: Set<tileId>,
 *   pendingClaims: Map<tileId, claim>,
 *   history: Array<object>,
 *   tileStats: Map<tileId, number>,
 *   winners: Array<{ username, at, lines, rank }>
 * }
 */
const rooms = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.get("/health", (_req, res) => {
  const summary = [...rooms.values()].map((room) => ({
    room: room.name,
    viewers: room.viewers.size,
    controllers: room.controllers.size,
    confirmedCount: room.confirmedTiles.size,
    pendingCount: room.pendingClaims.size,
    createdAt: room.createdAt,
  }));

  res.json({
    ok: true,
    now: Date.now(),
    claimTtlMs: CLAIM_TTL_MS,
    defaultRoom: DEFAULT_ROOM,
    rooms: summary,
  });
});

app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  res.send(
    `window.APP_CONFIG = ${JSON.stringify({
      defaultRoom: DEFAULT_ROOM,
      claimTtlMs: CLAIM_TTL_MS,
      port: PORT,
    })};`
  );
});

app.get("/host", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "host.html"));
});

app.get("/host.html", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "host.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "viewer.html"));
});

io.on("connection", (socket) => {
  socket.data.room = null;
  socket.data.role = null;
  socket.data.username = null;

  emitGlobalMeta(socket);

  onMany(socket, ["host:create", "createRoom", "room:create"], (payload = {}, ack) => {
    try {
      const roomName = normalizeRoom(payload.room || DEFAULT_ROOM);
      const hostKey = String(payload.hostKey || payload.key || "").trim();
      const forceReset = !!payload.forceReset;

      if (!hostKey) {
        return replyError(socket, ack, "host_key_required", "Host anahtarı boş olamaz.");
      }

      let room = rooms.get(roomName);

      if (room && room.hostKey !== hostKey) {
        return replyError(
          socket,
          ack,
          "room_exists_with_different_key",
          "Bu oda zaten farklı bir host anahtarı ile oluşturulmuş."
        );
      }

      if (!room || forceReset) {
        room = createRoom(roomName, hostKey);
        rooms.set(roomName, room);
      }

      attachSocketToRoom(socket, room.name);
      addController(socket, room, hostKey);

      room.history.push({
        type: "room_created_or_joined_by_host",
        at: Date.now(),
        by: socket.id,
      });

      emitRoomState(room.name);

      return replyOk(ack, {
        room: room.name,
        role: "controller",
        createdAt: room.createdAt,
        claimTtlMs: CLAIM_TTL_MS,
      });
    } catch (err) {
      return replyError(socket, ack, "create_room_failed", err.message || "Oda oluşturulamadı.");
    }
  });

  onMany(socket, ["host:login", "mod:login", "room:auth"], (payload = {}, ack) => {
    try {
      const roomName = normalizeRoom(payload.room || DEFAULT_ROOM);
      const hostKey = String(payload.hostKey || payload.key || "").trim();

      if (!hostKey) {
        return replyError(socket, ack, "host_key_required", "Host anahtarı boş olamaz.");
      }

      const room = rooms.get(roomName);
      if (!room) {
        return replyError(socket, ack, "room_not_found", "Oda bulunamadı.");
      }

      if (room.hostKey !== hostKey) {
        return replyError(socket, ack, "invalid_host_key", "Host anahtarı hatalı.");
      }

      attachSocketToRoom(socket, room.name);
      addController(socket, room, hostKey);

      room.history.push({
        type: "controller_joined",
        at: Date.now(),
        by: socket.id,
      });

      emitRoomState(room.name);

      return replyOk(ack, {
        room: room.name,
        role: "controller",
        claimTtlMs: CLAIM_TTL_MS,
      });
    } catch (err) {
      return replyError(socket, ack, "host_login_failed", err.message || "Host girişi başarısız.");
    }
  });

  onMany(socket, ["viewer:join", "joinRoom", "room:join"], (payload = {}, ack) => {
    try {
      const roomName = normalizeRoom(payload.room || DEFAULT_ROOM);
      const username = sanitizeName(payload.username || payload.name || "");

      const room = rooms.get(roomName);
      if (!room) {
        return replyError(
          socket,
          ack,
          "room_not_ready",
          "Oda henüz yayıncı tarafından oluşturulmamış."
        );
      }

      if (!username) {
        return replyError(socket, ack, "username_required", "İsim boş olamaz.");
      }

      attachSocketToRoom(socket, room.name);
      addViewer(socket, room, username);

      room.history.push({
        type: "viewer_joined",
        at: Date.now(),
        username,
        socketId: socket.id,
      });

      emitRoomState(room.name);

      return replyOk(ack, {
        room: room.name,
        role: "viewer",
        username,
        claimTtlMs: CLAIM_TTL_MS,
      });
    } catch (err) {
      return replyError(socket, ack, "join_failed", err.message || "Odaya giriş başarısız.");
    }
  });

  onMany(socket, ["viewer:claim", "claimTile", "tile:claim"], (payload = {}, ack) => {
    try {
      const room = getSocketRoomOrFail(socket, payload.room);
      if (socket.data.role !== "viewer") {
        return replyError(socket, ack, "not_viewer", "Bu işlem sadece izleyici içindir.");
      }

      const tileId = normalizeTile(payload.tileId || payload.id || payload.tile || "");
      const username =
        sanitizeName(payload.username || payload.name || socket.data.username || "") ||
        "İzleyici";

      if (!tileId) {
        return replyError(socket, ack, "tile_required", "Kutu bilgisi eksik.");
      }

      if (room.confirmedTiles.has(tileId)) {
        return replyError(socket, ack, "already_confirmed", "Bu kutu zaten onaylanmış.");
      }

      const existing = room.pendingClaims.get(tileId);
      if (existing && existing.expiresAt > Date.now()) {
        return replyError(
          socket,
          ack,
          "claim_pending",
          "Bu kutu için zaten bekleyen bir onay var."
        );
      }

      const claim = {
        id: crypto.randomUUID(),
        room: room.name,
        tileId,
        username,
        socketId: socket.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + CLAIM_TTL_MS,
        status: "pending",
      };

      room.pendingClaims.set(tileId, claim);
      room.history.push({
        type: "claim_created",
        at: claim.createdAt,
        tileId,
        username,
      });

      scheduleClaimExpiry(room.name, tileId, claim.id);
      emitRoomState(room.name);

      io.to(roomChannel(room.name)).emit("claim:created", publicClaim(claim));

      return replyOk(ack, {
        claim: publicClaim(claim),
      });
    } catch (err) {
      return replyError(socket, ack, "claim_failed", err.message || "Kutu talebi oluşturulamadı.");
    }
  });

  onMany(socket, ["host:confirm", "confirmTile", "tile:confirm"], (payload = {}, ack) => {
    try {
      const room = authorizeController(socket, payload);
      const tileId = normalizeTile(payload.tileId || payload.id || payload.tile || "");

      if (!tileId) {
        return replyError(socket, ack, "tile_required", "Kutu bilgisi eksik.");
      }

      const pending = room.pendingClaims.get(tileId);

      if (pending) {
        room.pendingClaims.delete(tileId);
      }

      room.confirmedTiles.add(tileId);
      room.tileStats.set(tileId, (room.tileStats.get(tileId) || 0) + 1);

      room.history.push({
        type: "tile_confirmed",
        at: Date.now(),
        tileId,
        by: socket.id,
        username: pending?.username || null,
      });

      io.to(roomChannel(room.name)).emit("claim:confirmed", {
        tileId,
        username: pending?.username || null,
        confirmedAt: Date.now(),
      });

      emitRoomState(room.name);

      return replyOk(ack, {
        ok: true,
        tileId,
        confirmed: true,
      });
    } catch (err) {
      return replyError(socket, ack, "confirm_failed", err.message || "Onay başarısız.");
    }
  });

  onMany(socket, ["host:reject", "rejectTile", "tile:reject"], (payload = {}, ack) => {
    try {
      const room = authorizeController(socket, payload);
      const tileId = normalizeTile(payload.tileId || payload.id || payload.tile || "");

      if (!tileId) {
        return replyError(socket, ack, "tile_required", "Kutu bilgisi eksik.");
      }

      const pending = room.pendingClaims.get(tileId);
      if (!pending) {
        return replyError(socket, ack, "claim_not_found", "Bekleyen talep bulunamadı.");
      }

      room.pendingClaims.delete(tileId);
      room.history.push({
        type: "tile_rejected",
        at: Date.now(),
        tileId,
        by: socket.id,
        username: pending.username,
      });

      io.to(roomChannel(room.name)).emit("claim:rejected", {
        tileId,
        username: pending.username,
        rejectedAt: Date.now(),
      });

      emitRoomState(room.name);

      return replyOk(ack, {
        ok: true,
        tileId,
        rejected: true,
      });
    } catch (err) {
      return replyError(socket, ack, "reject_failed", err.message || "Reddetme başarısız.");
    }
  });

  onMany(socket, ["host:unconfirm", "tile:unconfirm", "host:clearTile"], (payload = {}, ack) => {
    try {
      const room = authorizeController(socket, payload);
      const tileId = normalizeTile(payload.tileId || payload.id || payload.tile || "");

      if (!tileId) {
        return replyError(socket, ack, "tile_required", "Kutu bilgisi eksik.");
      }

      const existed = room.confirmedTiles.delete(tileId);

      room.history.push({
        type: "tile_unconfirmed",
        at: Date.now(),
        tileId,
        by: socket.id,
      });

      io.to(roomChannel(room.name)).emit("tile:unconfirmed", {
        tileId,
        at: Date.now(),
      });

      emitRoomState(room.name);

      return replyOk(ack, {
        ok: true,
        tileId,
        removed: existed,
      });
    } catch (err) {
      return replyError(socket, ack, "unconfirm_failed", err.message || "Kutu geri alınamadı.");
    }
  });

  onMany(socket, ["host:reset", "resetRoom", "room:reset"], (payload = {}, ack) => {
    try {
      const room = authorizeController(socket, payload);

      room.confirmedTiles.clear();
      room.pendingClaims.clear();
      room.tileStats.clear();
      room.winners = [];
      room.history.push({
        type: "room_reset",
        at: Date.now(),
        by: socket.id,
      });

      io.to(roomChannel(room.name)).emit("room:reset:done", {
        room: room.name,
        at: Date.now(),
      });

      emitRoomState(room.name);

      return replyOk(ack, {
        ok: true,
        room: room.name,
      });
    } catch (err) {
      return replyError(socket, ack, "reset_failed", err.message || "Oda sıfırlanamadı.");
    }
  });

  onMany(socket, ["viewer:bingo", "bingo:claim"], (payload = {}, ack) => {
    try {
      const room = getSocketRoomOrFail(socket, payload.room);
      const username =
        sanitizeName(payload.username || payload.name || socket.data.username || "") ||
        "İzleyici";
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      const alreadyRanked = room.winners.find((w) => w.username === username);

      if (!alreadyRanked) {
        const winner = {
          username,
          at: Date.now(),
          lines,
          rank: room.winners.length + 1,
        };
        room.winners.push(winner);
        room.history.push({
          type: "bingo_claimed",
          at: winner.at,
          username,
          rank: winner.rank,
        });

        io.to(roomChannel(room.name)).emit("bingo:ranked", winner);
        emitRoomState(room.name);

        return replyOk(ack, winner);
      }

      return replyOk(ack, alreadyRanked);
    } catch (err) {
      return replyError(socket, ack, "bingo_failed", err.message || "Bingo bildirilemedi.");
    }
  });

  onMany(socket, ["room:state", "getState", "sync"], (payload = {}, ack) => {
    try {
      const room = getSocketRoomOrFail(socket, payload.room, { allowMissingSocketRoom: true });
      const state = buildRoomState(room);
      if (typeof ack === "function") return ack({ ok: true, state });
      emitStateToSocket(socket, room.name);
    } catch (err) {
      return replyError(socket, ack, "state_failed", err.message || "Durum alınamadı.");
    }
  });

  socket.on("disconnect", () => {
    const roomName = socket.data.room;
    if (!roomName) return;

    const room = rooms.get(roomName);
    if (!room) return;

    if (room.controllers.has(socket.id)) {
      room.controllers.delete(socket.id);
      room.socketRoles.delete(socket.id);
      room.history.push({
        type: "controller_left",
        at: Date.now(),
        socketId: socket.id,
      });
    }

    if (room.viewers.has(socket.id)) {
      const viewer = room.viewers.get(socket.id);
      room.viewers.delete(socket.id);
      room.socketRoles.delete(socket.id);
      room.history.push({
        type: "viewer_left",
        at: Date.now(),
        socketId: socket.id,
        username: viewer?.username || null,
      });
    }

    emitRoomState(room.name);
  });
});

/* =========================
   HELPERS
========================= */

function normalizeRoom(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 50) || "anaoda";
}

function normalizeTile(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 100);
}

function sanitizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function roomChannel(roomName) {
  return `${ROOM_PREFIX}${roomName}`;
}

function createRoom(roomName, hostKey) {
  return {
    name: roomName,
    createdAt: Date.now(),
    hostKey: String(hostKey),
    controllers: new Set(),
    viewers: new Map(),
    socketRoles: new Map(),
    confirmedTiles: new Set(),
    pendingClaims: new Map(),
    history: [],
    tileStats: new Map(),
    winners: [],
  };
}

function onMany(socket, events, handler) {
  for (const event of events) {
    socket.on(event, (...args) => {
      const maybeAck = typeof args[args.length - 1] === "function" ? args.pop() : null;
      const payload = args[0] || {};
      handler(payload, maybeAck);
    });
  }
}

function replyOk(ack, data = {}) {
  if (typeof ack === "function") ack({ ok: true, ...data });
}

function replyError(socket, ack, code, message) {
  const payload = { ok: false, code, message };
  socket.emit("app:error", payload);
  if (typeof ack === "function") ack(payload);
}

function attachSocketToRoom(socket, roomName) {
  const prevRoom = socket.data.room;
  if (prevRoom && prevRoom !== roomName) {
    socket.leave(roomChannel(prevRoom));
  }
  socket.join(roomChannel(roomName));
  socket.data.room = roomName;
}

function addController(socket, room, _hostKey) {
  room.controllers.add(socket.id);
  room.socketRoles.set(socket.id, "controller");
  socket.data.role = "controller";
  socket.data.username = null;
}

function addViewer(socket, room, username) {
  room.viewers.set(socket.id, {
    username,
    joinedAt: Date.now(),
  });
  room.socketRoles.set(socket.id, "viewer");
  socket.data.role = "viewer";
  socket.data.username = username;
}

function getSocketRoomOrFail(socket, requestedRoom, options = {}) {
  const roomName = normalizeRoom(requestedRoom || socket.data.room || DEFAULT_ROOM);
  const room = rooms.get(roomName);

  if (!room) {
    throw new Error("Oda bulunamadı.");
  }

  if (!options.allowMissingSocketRoom && socket.data.room !== roomName) {
    throw new Error("Bu odaya bağlı değilsin.");
  }

  return room;
}

function authorizeController(socket, payload = {}) {
  const roomName = normalizeRoom(payload.room || socket.data.room || DEFAULT_ROOM);
  const room = rooms.get(roomName);

  if (!room) {
    throw new Error("Oda bulunamadı.");
  }

  if (room.controllers.has(socket.id) || socket.data.role === "controller") {
    attachSocketToRoom(socket, room.name);
    addController(socket, room, room.hostKey);
    return room;
  }

  const suppliedKey = String(payload.hostKey || payload.key || "").trim();
  if (!suppliedKey) {
    throw new Error("Host anahtarı gerekli.");
  }

  if (room.hostKey !== suppliedKey) {
    throw new Error("Host anahtarı hatalı.");
  }

  attachSocketToRoom(socket, room.name);
  addController(socket, room, room.hostKey);
  return room;
}

function publicClaim(claim) {
  return {
    id: claim.id,
    room: claim.room,
    tileId: claim.tileId,
    username: claim.username,
    createdAt: claim.createdAt,
    expiresAt: claim.expiresAt,
    status: claim.status,
  };
}

function buildRoomState(room) {
  const now = Date.now();

  const pendingClaims = [...room.pendingClaims.values()]
    .filter((claim) => claim.expiresAt > now)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(publicClaim);

  const viewers = [...room.viewers.values()]
    .map((v) => v.username)
    .sort((a, b) => a.localeCompare(b, "tr"));

  const tileStats = Object.fromEntries(
    [...room.tileStats.entries()].sort(([a], [b]) => a.localeCompare(b))
  );

  return {
    room: room.name,
    createdAt: room.createdAt,
    claimTtlMs: CLAIM_TTL_MS,
    onlineCount: room.viewers.size + room.controllers.size,
    viewerCount: room.viewers.size,
    controllerCount: room.controllers.size,
    viewers,
    confirmedTiles: [...room.confirmedTiles].sort(),
    pendingClaims,
    history: room.history.slice(-100),
    tileStats,
    winners: room.winners.slice(0, 10),
    hasHost: room.controllers.size > 0,
  };
}

function emitRoomState(roomName) {
  const room = rooms.get(roomName);
  if (!room) return;

  const state = buildRoomState(room);

  io.to(roomChannel(roomName)).emit("room:state", state);
  io.to(roomChannel(roomName)).emit("state", state);
  io.to(roomChannel(roomName)).emit("syncState", state);
  io.to(roomChannel(roomName)).emit("viewer:state", state);
  io.to(roomChannel(roomName)).emit("host:state", state);
}

function emitStateToSocket(socket, roomName) {
  const room = rooms.get(roomName);
  if (!room) return;

  const state = buildRoomState(room);
  socket.emit("room:state", state);
  socket.emit("state", state);
  socket.emit("syncState", state);
  socket.emit("viewer:state", state);
  socket.emit("host:state", state);
}

function emitGlobalMeta(socket) {
  socket.emit("app:meta", {
    now: Date.now(),
    defaultRoom: DEFAULT_ROOM,
    claimTtlMs: CLAIM_TTL_MS,
  });
}

function scheduleClaimExpiry(roomName, tileId, claimId) {
  setTimeout(() => {
    const room = rooms.get(roomName);
    if (!room) return;

    const claim = room.pendingClaims.get(tileId);
    if (!claim) return;
    if (claim.id !== claimId) return;
    if (claim.expiresAt > Date.now()) return;

    room.pendingClaims.delete(tileId);
    room.history.push({
      type: "claim_expired",
      at: Date.now(),
      tileId,
      username: claim.username,
    });

    io.to(roomChannel(roomName)).emit("claim:expired", {
      tileId,
      username: claim.username,
      expiredAt: Date.now(),
    });

    emitRoomState(roomName);
  }, CLAIM_TTL_MS + 250);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Bingo server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ Default room: ${DEFAULT_ROOM}`);
  console.log(`✅ Claim TTL: ${CLAIM_TTL_MS}ms`);
});
