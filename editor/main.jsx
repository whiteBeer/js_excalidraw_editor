import { CaptureUpdateAction, Excalidraw, getSceneVersion, reconcileElements } from '@excalidraw/excalidraw';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';

import '@excalidraw/excalidraw/index.css';

import {
  pendingElements,
  pendingFiles,
  rememberAppliedScene,
  rememberElementVersions,
  rememberFileSizes,
} from './boardSync.js';

const COLLAB_COLORS = ['#846358', '#1e88e5', '#43a047', '#e53935', '#8e24aa', '#fb8c00', '#00897b', '#6d4c41'];
const FLUSH_MS = 50;

function colorFor(userId) {
  const hex = COLLAB_COLORS[Math.abs(userId) % COLLAB_COLORS.length];
  return { background: hex, stroke: hex };
}

function asFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return {};
  return files;
}

function filesSignature(files) {
  const keys = Object.keys(files).sort();
  let size = 0;
  for (const key of keys) size += files[key]?.dataURL?.length ?? 0;
  return `${keys.join(',')}:${size}`;
}

function relaySocketUrl() {
  const url = new URL(location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = url.pathname.replace(/\/editor\/?$/, '');
  url.pathname = path === '' ? '/' : path;
  url.search = '';
  url.hash = '';
  return url.href;
}

function postParent(payload) {
  window.parent.postMessage(payload, '*');
}

function Canvas({ session, theme }) {
  const apiRef = useRef(null);
  const applyingRef = useRef(false);
  const lastVersionRef = useRef(0);
  const lastFilesRef = useRef('');
  const wsRef = useRef(null);
  const flushTimerRef = useRef(null);
  const lastFlushAtRef = useRef(0);
  const sentVersionsRef = useRef(new Map());
  const sentFileSizesRef = useRef(new Map());
  const pointerAtRef = useRef(0);
  const closedRef = useRef(false);
  const deniedRef = useRef(false);
  const collabRef = useRef(new Map());

  const absorbFiles = (files) => {
    const api = apiRef.current;
    if (!api) return;
    const normalized = asFiles(files);
    rememberFileSizes(normalized, sentFileSizesRef.current);
    const list = Object.values(normalized);
    if (list.length > 0) api.addFiles(list);
    lastFilesRef.current = filesSignature(asFiles(api.getFiles()));
  };

  const flushCollab = () => {
    flushTimerRef.current = null;
    if (applyingRef.current) {
      flushTimerRef.current = window.setTimeout(flushCollab, FLUSH_MS);
      return;
    }
    const api = apiRef.current;
    if (!api) return;
    lastFlushAtRef.current = Date.now();
    const elements = api.getSceneElementsIncludingDeleted();
    const changed = pendingElements(elements, sentVersionsRef.current);
    const files = asFiles(api.getFiles());
    const filesDelta = pendingFiles(files, sentFileSizesRef.current);
    lastVersionRef.current = getSceneVersion(elements);
    lastFilesRef.current = filesSignature(files);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (changed.length > 0 || Object.keys(filesDelta).length > 0) {
        postParent({ type: 'board-save', elements: [...elements], files });
      }
      return;
    }
    if (changed.length > 0) {
      ws.send(JSON.stringify({ type: 'elements', elements: changed }));
      rememberElementVersions(changed, sentVersionsRef.current);
    }
    if (Object.keys(filesDelta).length > 0) {
      ws.send(JSON.stringify({ type: 'files', files: filesDelta }));
      rememberFileSizes(filesDelta, sentFileSizesRef.current);
    }
  };

  const publishScene = () => {
    if (applyingRef.current) return;
    const api = apiRef.current;
    if (!api) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const version = getSceneVersion(elements);
    const signature = filesSignature(asFiles(api.getFiles()));
    if (version === lastVersionRef.current && signature === lastFilesRef.current) return;
    const wait = FLUSH_MS - (Date.now() - lastFlushAtRef.current);
    if (wait <= 0) {
      flushCollab();
      return;
    }
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(flushCollab, wait);
  };

  const connect = () => {
    if (deniedRef.current || closedRef.current) return;
    const previous = wsRef.current;
    wsRef.current = null;
    previous?.close();
    const ws = new WebSocket(relaySocketUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', boardId: session.boardId, token: session.token }));
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const api = apiRef.current;
      if (!api) return;
      if ((message.type === 'ready' || message.type === 'elements') && message.elements) {
        applyingRef.current = true;
        const before = api.getSceneElementsIncludingDeleted().map((element) => ({
          id: element.id,
          version: element.version,
        }));
        api.updateScene({
          elements: reconcileElements(api.getSceneElementsIncludingDeleted(), message.elements, api.getAppState()),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        const scene = api.getSceneElementsIncludingDeleted();
        rememberAppliedScene(before, scene, sentVersionsRef.current);
        lastVersionRef.current = getSceneVersion(scene);
        if (message.type === 'ready' && message.files) absorbFiles(message.files);
        applyingRef.current = false;
        if (message.type === 'ready') {
          postParent({ type: 'board-live', live: true });
          flushCollab();
        }
      }
      if (message.type === 'files' && message.files) {
        applyingRef.current = true;
        absorbFiles(message.files);
        applyingRef.current = false;
      }
      if (message.type === 'pointer' && message.userId && message.pointer) {
        collabRef.current.set(String(message.userId), {
          username: message.name,
          pointer: message.pointer,
          button: message.button,
          color: colorFor(message.userId),
        });
        api.updateScene({ collaborators: collabRef.current });
      }
      if (message.type === 'presence') {
        const ids = new Set((message.users ?? []).map((user) => String(user.userId)));
        for (const id of collabRef.current.keys()) {
          if (!ids.has(id)) collabRef.current.delete(id);
        }
        api.updateScene({ collaborators: collabRef.current });
      }
      if (message.type === 'error') {
        deniedRef.current = message.error === 'access_denied';
        postParent({ type: 'board-live', live: false });
        ws.close();
      }
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      postParent({ type: 'board-live', live: false });
      if (!closedRef.current && !deniedRef.current) window.setTimeout(connect, 3000);
    };
  };

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      wsRef.current?.close();
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    };
  }, []);

  return (
    <Excalidraw
      aiEnabled={false}
      excalidrawAPI={(api) => {
        apiRef.current = api;
        const elements = api.getSceneElementsIncludingDeleted();
        const files = asFiles(api.getFiles());
        lastVersionRef.current = getSceneVersion(elements);
        lastFilesRef.current = filesSignature(files);
        rememberElementVersions(elements, sentVersionsRef.current);
        rememberFileSizes(files, sentFileSizesRef.current);
        connect();
      }}
      initialData={{
        elements: Array.isArray(session.scene?.elements) ? session.scene.elements : [],
        files: asFiles(session.scene?.files),
      }}
      isCollaborating
      langCode="ru-RU"
      theme={theme}
      onChange={publishScene}
      onPointerUpdate={(payload) => {
        const now = Date.now();
        if (now - pointerAtRef.current < 50) return;
        pointerAtRef.current = now;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'pointer', pointer: payload.pointer, button: payload.button }));
      }}
    />
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'board-open' && data.config?.boardId && data.config.token) {
        setSession(data.config);
        if (data.config.theme === 'dark' || data.config.theme === 'light') setTheme(data.config.theme);
      }
      if (data.type === 'board-theme' && (data.theme === 'dark' || data.theme === 'light')) setTheme(data.theme);
    };
    window.addEventListener('message', onMessage);
    postParent({ type: 'board-ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!session) return null;
  return <Canvas key={session.boardId} session={session} theme={theme} />;
}

createRoot(document.getElementById('root')).render(<App />);
