export function pendingElements(elements, sent) {
  const pending = [];
  for (const element of elements) {
    if (sent.get(element.id) !== element.version) pending.push(element);
  }
  return pending;
}

export function pendingFiles(files, sent) {
  const pending = {};
  for (const id of Object.keys(files)) {
    const size = files[id]?.dataURL?.length ?? 0;
    if (sent.get(id) !== size) pending[id] = files[id];
  }
  return pending;
}

export function rememberElementVersions(elements, sent) {
  for (const element of elements) sent.set(element.id, element.version);
}

export function rememberFileSizes(files, sent) {
  for (const id of Object.keys(files)) sent.set(id, files[id]?.dataURL?.length ?? 0);
}

/** Чужой пакет может поднять version. Свою несохранённую правку, которую reconcile оставил, не помечаем. */
export function rememberAppliedScene(before, after, sent) {
  const beforeVersion = new Map();
  for (const element of before) beforeVersion.set(element.id, element.version);
  for (const element of after) {
    const previous = beforeVersion.get(element.id);
    const keptUnsentLocal =
      previous !== undefined && sent.get(element.id) !== previous && previous === element.version;
    if (!keptUnsentLocal) sent.set(element.id, element.version);
  }
}
