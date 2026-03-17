import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DEFAULT_ROOM = normalizeRoom(process.env.DEFAULT_ROOM || 'anaoda');
const CLAIM_TTL_MS = Math.max(3000, Number(process.env.CLAIM_TTL_MS || 10000));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const tiles = [
  { id: 'iliskitavsiyesi-r1c1', label: 'İlişki tavsiyesi' },
  { id: 'gaf-r1c2', label: 'Gaf' },
  { id: 'eyt-r1c3', label: 'EYT' },
  { id: 'dusmanlarivar-r1c4', label: 'Düşmanları var' },
  { id: 'irkcilik-r1c5', label: 'Irkçılık' },
  { id: 'fb-r2c1', label: 'Fenerbahçe' },
  { id: 'cillik-r2c2', label: 'Çillik' },
  { id: 'erkekkotuleme-r2c3', label: 'Erkek kötüleme' },
  { id: 'nolan-r2c4', label: 'Nolan' },
  { id: 'gs-r2c5', label: 'Galatasaray' },
  { id: 'drama-r3c1', label: 'Drama' },
  { id: 'cuce-r3c2', label: 'Cüce' },
  { id: 'zengin-r3c3', label: 'Zengin' },
  { id: 'dul-r3c4', label: 'Dul' },
  { id: 'ayaj-r3c5', label: 'Ayak' }
];

const lines = [
  ['iliskitavsiyesi-r1c1', 'gaf-r1c2', 'eyt-r1c3', 'dusmanlarivar-r1c4', 'irkcilik-r1c5'],
  ['fb-r2c1', 'cillik-r2c2', 'erkekkotuleme-r2c3', 'nolan-r2c4', 'gs-r2c5'],
  ['drama-r3c1', 'cuce-r3c2', 'zengin-r3c3', 'dul-r3c4', 'ayaj-r3c5'],
  ['iliskitavsiyesi-r1c1', 'fb-r2c1', 'drama-r3c1'],
  ['gaf-r1c2', 'cillik-r2c2', 'cuce-r3c2'],
  ['eyt-r1c3', 'erkekkotuleme-r2c3', 'zengin-r3c3'],
  ['dusmanlarivar-r1c4', 'nolan-r2c4', 'dul-r3c4'],
  ['irkcilik-r1c5', 'gs-r2c5', 'ayaj-r3c5'],
  ['iliskitavsiyesi-r1c1', 'cillik-r2c2', 'zengin-r3c3'],
  ['irkcilik-r1c5', 'nolan-r2c4', 'zengin-r3c3']
];

const rooms = new Map();

function normalizeRoom(room) {
  return String(room || DEFAULT_ROOM).trim().toLowerCase().replace(/[^a-z0-9-_]/gi, '').slice(0, 32) || DEFAULT_ROOM;
}

function createRoomState(roomId) {
  return {
    roomId,
    hostKey: null,
    confirmedTiles: [],
    pendingClaim: null,
    history: [],
    bingoEvents: [],
    tileClaims: Object.fromEntries(tiles.map(tile => [tile.id, 0])),
    viewerNames: new Set(),
    hostSocketIds: new Set(),
    updatedAt: Date.now()
  };
}

function getRoom(roomId) {
  const id = normalizeRoom(roomId);
  if (!rooms.has(id)) rooms.set(id, createRoomState(id));
  return rooms.get(id);
}

function hasRoom(roomId) {
  return rooms.has(normalizeRoom(roomId));
}

function getWinningLines(confirmedTiles) {
  const set = new Set(confirmedTiles);
  return lines.filter(line => line.every(tileId => set.has(tileId)));
}


function buildRadar(room) {
  const confirmedSet = new Set(room.confirmedTiles);
  const tileLabelMap = Object.fromEntries(tiles.map(tile => [tile.id, tile.label]));

  const hotTiles = tiles
    .map(tile => ({
      id: tile.id,
      label: tile.label,
      count: room.tileClaims[tile.id] || 0,
      confirmed: confirmedSet.has(tile.id)
    }))
    .filter(tile => tile.count > 0 || tile.confirmed)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.confirmed !== b.confirmed) return Number(b.confirmed) - Number(a.confirmed);
      return a.label.localeCompare(b.label, 'tr');
    })
    .slice(0, 5);

  const oneAwayLines = lines
    .map(line => {
      const missing = line.filter(tileId => !confirmedSet.has(tileId));
      if (missing.length !== 1) return null;
      return {
        missingTileId: missing[0],
        missingLabel: tileLabelMap[missing[0]] || missing[0],
        lineLabels: line.map(tileId => tileLabelMap[tileId] || tileId)
      };
    })
    .filter(Boolean);

  return {
    onlineViewers: room.viewerNames.size,
    totalClaims: Object.values(room.tileClaims).reduce((sum, value) => sum + value, 0),
    hotTiles,
    oneAwayLines
  };
}

function roomSnapshot(room) {
  const now = Date.now();
  let pending = null;
  if (room.pendingClaim && room.pendingClaim.expiresAt > now) {
    pending = {
      ...room.pendingClaim,
      remainingMs: room.pendingClaim.expiresAt - now
    };
  }
  return {
    roomId: room.roomId,
    roomExists: true,
    tiles,
    confirmedTiles: room.confirmedTiles,
    pendingClaim: pending,
    winningLines: getWinningLines(room.confirmedTiles),
    history: room.history.slice(-12),
    bingoEvents: room.bingoEvents.slice(0, 10),
    radar: buildRadar(room)
  };
}

function emitRoomState(roomId) {
  const room = getRoom(roomId);
  io.to(`room:${roomId}`).emit('room:state', roomSnapshot(room));
}

function pushHistory(room, item) {
  room.history.push(item);
  if (room.history.length > 80) room.history = room.history.slice(-80);
}

function clearExpiredClaim(roomId) {
  const room = getRoom(roomId);
  if (!room.pendingClaim) return;
  if (room.pendingClaim.expiresAt > Date.now()) return;
  const expired = room.pendingClaim;
  room.pendingClaim = null;
  pushHistory(room, {
    type: 'expired',
    tileId: expired.tileId,
    tileLabel: expired.tileLabel,
    viewerName: expired.viewerName,
    at: Date.now()
  });
  room.updatedAt = Date.now();
  emitRoomState(roomId);
}

setInterval(() => {
  for (const roomId of rooms.keys()) clearExpiredClaim(roomId);
}, 1000);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(`window.EREN_BINGO_CONFIG = ${JSON.stringify({
    defaultRoom: DEFAULT_ROOM,
    claimTtlMs: CLAIM_TTL_MS
  })};`);
});

app.get('/host', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

io.on('connection', socket => {

  socket.on('heartbeat', () => {
    socket.emit('heartbeat:ack', { ok: true, at: Date.now() });
  });

  socket.on('room:join', payload => {
    const roomId = normalizeRoom(payload?.room);
    const role = payload?.role === 'host' ? 'host' : 'viewer';
    const viewerName = String(payload?.viewerName || '').trim().slice(0, 30);
    const hostKey = String(payload?.hostKey || '').trim().slice(0, 80);

    if (role === 'viewer' && !viewerName) {
      socket.emit('join:error', { message: 'Kullanıcı adı boş bırakılamaz. Kick kullanıcı adınla aynı yazman en iyisi.' });
      return;
    }

    if (role === 'viewer' && !hasRoom(roomId)) {
      socket.emit('join:error', { message: 'Bu oda henüz host tarafından açılmadı.' });
      return;
    }

    if (role === 'host' && !hostKey) {
      socket.emit('auth:error', { message: 'Bu oturum için bir host anahtarı belirlemelisin.' });
      return;
    }

    const room = getRoom(roomId);

    if (role === 'host') {
      if (!room.hostKey) {
        room.hostKey = hostKey;
      } else if (room.hostKey !== hostKey) {
        socket.emit('auth:error', { message: 'Bu oda başka bir host anahtarı ile kilitli.' });
        return;
      }
    }

    socket.data.roomId = roomId;
    socket.data.role = role;
    socket.data.viewerName = viewerName;
    if (role === 'viewer' && viewerName) room.viewerNames.add(viewerName);
    if (role === 'host') room.hostSocketIds.add(socket.id);
    socket.join(`room:${roomId}`);
    socket.emit('room:joined', { roomId, role, viewerName });
    emitRoomState(roomId);
  });

  socket.on('claim:create', payload => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role !== 'viewer') return;

    clearExpiredClaim(roomId);
    const room = getRoom(roomId);
    const tileId = String(payload?.tileId || '');
    const tile = tiles.find(t => t.id === tileId);
    if (!tile) return;

    if (room.confirmedTiles.includes(tileId)) {
      socket.emit('claim:error', { message: 'Bu kutu zaten onaylandı.' });
      return;
    }

    if (room.pendingClaim) {
      socket.emit('claim:error', { message: 'Şu an başka bir onay bekliyor.' });
      return;
    }

    room.tileClaims[tileId] = (room.tileClaims[tileId] || 0) + 1;
    room.pendingClaim = {
      tileId,
      tileLabel: tile.label,
      viewerName: socket.data.viewerName,
      viewerSocketId: socket.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + CLAIM_TTL_MS
    };
    pushHistory(room, {
      type: 'claim',
      tileId,
      tileLabel: tile.label,
      viewerName: room.pendingClaim.viewerName,
      at: Date.now()
    });
    room.updatedAt = Date.now();
    emitRoomState(roomId);
  });

  socket.on('claim:cancel', () => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role !== 'viewer') return;
    const room = getRoom(roomId);
    if (!room.pendingClaim || room.pendingClaim.viewerSocketId !== socket.id) return;
    pushHistory(room, {
      type: 'cancelled',
      tileId: room.pendingClaim.tileId,
      tileLabel: room.pendingClaim.tileLabel,
      viewerName: room.pendingClaim.viewerName,
      at: Date.now()
    });
    room.pendingClaim = null;
    room.updatedAt = Date.now();
    emitRoomState(roomId);
  });

  socket.on('host:confirmTile', payload => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role !== 'host') return;

    clearExpiredClaim(roomId);
    const room = getRoom(roomId);
    const tileId = String(payload?.tileId || '');
    const tile = tiles.find(t => t.id === tileId);
    if (!tile) return;

    if (room.confirmedTiles.includes(tileId)) return;

    if (!room.pendingClaim || room.pendingClaim.tileId !== tileId) {
      socket.emit('claim:error', { message: 'Bu kutu için aktif bekleyen claim yok.' });
      return;
    }

    const beforeWinningCount = getWinningLines(room.confirmedTiles).length;
    const claimant = room.pendingClaim;

    room.confirmedTiles.push(tileId);
    pushHistory(room, {
      type: 'confirmed',
      tileId,
      tileLabel: tile.label,
      viewerName: claimant.viewerName,
      at: Date.now()
    });

    const afterWinningCount = getWinningLines(room.confirmedTiles).length;
    if (afterWinningCount > beforeWinningCount) {
      const event = {
        rank: room.bingoEvents.length + 1,
        viewerName: claimant.viewerName,
        tileId,
        tileLabel: tile.label,
        at: Date.now(),
        totalLines: afterWinningCount,
        newLines: afterWinningCount - beforeWinningCount
      };
      room.bingoEvents.push(event);
      pushHistory(room, {
        type: 'bingo',
        tileId,
        tileLabel: tile.label,
        viewerName: claimant.viewerName,
        at: event.at,
        rank: event.rank
      });
      io.to(claimant.viewerSocketId).emit('viewer:bingoRank', event);
      io.to(`room:${roomId}`).emit('room:bingoEvent', event);
    }

    room.pendingClaim = null;
    room.updatedAt = Date.now();
    emitRoomState(roomId);
  });

  socket.on('host:rejectClaim', () => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role !== 'host') return;
    const room = getRoom(roomId);
    if (!room.pendingClaim) return;
    pushHistory(room, {
      type: 'rejected',
      tileId: room.pendingClaim.tileId,
      tileLabel: room.pendingClaim.tileLabel,
      viewerName: room.pendingClaim.viewerName,
      at: Date.now()
    });
    room.pendingClaim = null;
    room.updatedAt = Date.now();
    emitRoomState(roomId);
  });

  socket.on('host:resetRoom', () => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role !== 'host') return;
    const previous = getRoom(roomId);
    const reset = createRoomState(roomId);
    reset.hostKey = previous.hostKey;
    rooms.set(roomId, reset);
    emitRoomState(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (socket.data.role === 'viewer' && socket.data.viewerName) room.viewerNames.delete(socket.data.viewerName);
    if (socket.data.role === 'host') room.hostSocketIds.delete(socket.id);
    if (room.pendingClaim?.viewerSocketId === socket.id) {
      pushHistory(room, {
        type: 'disconnect',
        tileId: room.pendingClaim.tileId,
        tileLabel: room.pendingClaim.tileLabel,
        viewerName: room.pendingClaim.viewerName,
        at: Date.now()
      });
      room.pendingClaim = null;
    }
    room.updatedAt = Date.now();
    emitRoomState(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`Eren Bingo çalışıyor: http://localhost:${PORT}`);
});
