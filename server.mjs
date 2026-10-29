import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';

import { deltaOf, mergeElements } from './merge.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, 'dist');
const apiFile = path.join(rootDir, 'public', 'api.js');

function stripBoardPrefix(pathname) {
  if (pathname === '/board-relay' || pathname === '/board-relay/') return '/';
  if (pathname.startsWith('/board-relay/')) return pathname.slice('/board-relay'.length) || '/';
  return pathname;
}

export function classify(pathname) {
  const route = stripBoardPrefix(pathname);
  if (route === '/' || route === '') return { type: 'health' };
  if (route === '/api.js') return { type: 'api' };
  if (route === '/editor') return { type: 'redirect' };
  if (route === '/editor/' || route === '/editor/index.html') return { type: 'file', rel: 'index.html' };
  if (route.startsWith('/editor/')) {
    const rel = route.slice('/editor/'.length);
    if (rel === '' || rel.split('/').includes('..')) return { type: 'missing' };
    return { type: 'file', rel };
  }
  return { type: 'missing' };
}

const fileTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

function sendFile(res, filePath, cache) {
  res.writeHead(200, {
    'Content-Type': fileTypes[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': cache,
  });
  createReadStream(filePath).pipe(res);
}

function distFile(rel) {
  const root = path.resolve(distDir);
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

const port = Number(process.env.BOARD_RELAY_PORT || 3010);
const apiUrl = (process.env.BOARD_API_URL || 'http://localhost:8081').replace(/\/+$/, '');

/** ponytail: в эфир уходит дельта по id. Полная сцена — только в ready и в сохранении на API. */
const rooms = new Map();

async function loadBoard(boardId, token) {
  const response = await fetch(`${apiUrl}/spa/api/documents-flow/boards/${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}

async function saveScene(boardId, token, scene) {
  const response = await fetch(`${apiUrl}/spa/api/documents-flow/boards/${boardId}/scene`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(scene),
  });
  return response.ok;
}

function roomOf(boardId) {
  let room = rooms.get(boardId);
  if (!room) {
    room = {
      elements: [],
      files: {},
      clients: new Set(),
      seeded: false,
      dirty: false,
      timer: null,
    };
    rooms.set(boardId, room);
  }
  return room;
}

function filesOf(scene) {
  const files = scene?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return {};
  return files;
}

function enqueue(room, task) {
  const run = (room.queue || Promise.resolve()).then(task, task);
  room.queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function joinRoom(room, boardId, token) {
  return enqueue(room, async () => {
    const loaded = await loadBoard(boardId, token);
    if (!loaded?.board?.me?.id) return null;
    if (!room.seeded) {
      room.elements = Array.isArray(loaded.board.scene.elements) ? loaded.board.scene.elements : [];
      room.files = filesOf(loaded.board.scene);
      room.seeded = true;
    }
    return loaded;
  });
}

function presence(room) {
  return [...room.clients].map((client) => ({ userId: client.userId, name: client.name }));
}

function send(socket, payload) {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
}

function broadcast(room, payload, except) {
  const raw = JSON.stringify(payload);
  for (const client of room.clients) {
    if (client.ws !== except && client.ws.readyState === 1) client.ws.send(raw);
  }
}

function tokenOf(room) {
  for (const client of room.clients) {
    if (client.token) return client.token;
  }
  return null;
}

async function flush(room, boardId) {
  if (!room.dirty) return;
  const token = tokenOf(room);
  if (!token) return;
  room.dirty = false;
  const ok = await saveScene(boardId, token, { elements: room.elements, files: room.files });
  if (!ok) room.dirty = true;
}

function scheduleSave(room, boardId) {
  room.dirty = true;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    void flush(room, boardId);
  }, 1500);
}

const httpServer = createServer((req, res) => {
  let pathname = '/';
  let search = '';
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
    search = url.search;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const route = classify(pathname);
  if (route.type === 'health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  if (route.type === 'redirect') {
    res.writeHead(302, { Location: `${pathname}/${search}` });
    res.end();
    return;
  }
  if (route.type === 'api') {
    sendFile(res, apiFile, 'no-cache');
    return;
  }
  if (route.type === 'file') {
    const filePath = distFile(route.rel);
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      const missingBuild = route.rel === 'index.html';
      res.writeHead(missingBuild ? 503 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(missingBuild ? 'editor is not built' : '');
      return;
    }
    sendFile(res, filePath, route.rel === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 8_000_000 });

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    void onMessage(socket, raw.toString()).catch((error) => {
      console.error(error);
      send(socket, { type: 'error', error: 'relay_failed' });
      socket.close();
    });
  });
  socket.on('close', () => {
    const boardId = socket.boardId;
    const room = rooms.get(boardId);
    if (!room || !socket.client) return;
    room.clients.delete(socket.client);
    broadcast(room, { type: 'presence', users: presence(room) });
    if (room.clients.size === 0) {
      clearTimeout(room.timer);
      void flush(room, boardId).finally(() => {
        if (room.clients.size === 0) rooms.delete(boardId);
      });
    }
  });
});

async function onMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object') return;

  if (message.type === 'join') {
    const boardId = Number(message.boardId);
    const token = typeof message.token === 'string' ? message.token : '';
    if (!Number.isInteger(boardId) || boardId <= 0 || token === '') {
      send(socket, { type: 'error', error: 'invalid_json' });
      socket.close();
      return;
    }
    const room = roomOf(boardId);
    const loaded = await joinRoom(room, boardId, token);
    const me = loaded?.board?.me;
    if (!me?.id) {
      send(socket, { type: 'error', error: 'access_denied' });
      socket.close();
      return;
    }
    const client = { ws: socket, token, userId: me.id, name: me.fullName || 'Участник' };
    socket.client = client;
    socket.boardId = boardId;
    room.clients.add(client);
    send(socket, {
      type: 'ready',
      elements: room.elements,
      files: room.files,
      users: presence(room),
    });
    broadcast(room, { type: 'presence', users: presence(room) }, socket);
    return;
  }

  const room = rooms.get(socket.boardId);
  if (!room || !socket.client) return;

  if (message.type === 'elements' && Array.isArray(message.elements)) {
    room.elements = mergeElements(room.elements, message.elements);
    const delta = deltaOf(room.elements, message.elements);
    if (delta.length > 0) broadcast(room, { type: 'elements', elements: delta }, socket);
    scheduleSave(room, socket.boardId);
    return;
  }

  if (message.type === 'files' && message.files && typeof message.files === 'object' && !Array.isArray(message.files)) {
    room.files = { ...room.files, ...message.files };
    broadcast(room, { type: 'files', files: message.files }, socket);
    scheduleSave(room, socket.boardId);
    return;
  }

  if (message.type === 'pointer' && message.pointer) {
    broadcast(
      room,
      {
        type: 'pointer',
        userId: socket.client.userId,
        name: socket.client.name,
        pointer: message.pointer,
        button: message.button === 'down' ? 'down' : 'up',
      },
      socket,
    );
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  httpServer.listen(port, () => {
    console.log(`board relay on :${port}`);
  });
}
