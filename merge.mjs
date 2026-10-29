/** То же правило, что shouldDiscardRemoteElement в Excalidraw reconcile.ts, без appState. */

function keepLocal(local, remote) {
  if (local.version > remote.version) return true;
  if (local.version === remote.version && local.versionNonce < remote.versionNonce) return true;
  return false;
}

export function mergeElements(current, incoming) {
  const map = new Map();
  for (const element of current) {
    if (element && typeof element.id === 'string') map.set(element.id, element);
  }
  for (const remote of incoming) {
    if (!remote || typeof remote.id !== 'string') continue;
    const local = map.get(remote.id);
    if (!local || !keepLocal(local, remote)) map.set(remote.id, remote);
  }
  const elements = [...map.values()];
  elements.sort((a, b) => String(a.index ?? '').localeCompare(String(b.index ?? '')));
  return elements;
}

/** Элементы комнаты, которых касалось входящее сообщение. Остальные по сокету не едут. */
export function deltaOf(stored, incoming) {
  const ids = new Set();
  for (const element of incoming) {
    if (element && typeof element.id === 'string') ids.add(element.id);
  }
  const delta = [];
  for (const element of stored) {
    if (ids.has(element.id)) delta.push(element);
  }
  return delta;
}
