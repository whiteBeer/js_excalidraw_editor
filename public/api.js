(function () {
  const script = document.currentScript;
  if (!script || !script.src) return;
  const base = new URL('./', script.src);

  function Editor(elementId, config) {
    const host = document.getElementById(elementId);
    if (!host) throw new Error('board host missing');
    const iframe = document.createElement('iframe');
    iframe.title = 'Схема';
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
    const frameUrl = new URL('editor/', base);
    iframe.src = frameUrl.href;
    const targetOrigin = frameUrl.origin;

    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow || event.origin !== targetOrigin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'board-ready') {
        iframe.contentWindow.postMessage({ type: 'board-open', config }, targetOrigin);
        return;
      }
      if (data.type === 'board-save' || data.type === 'board-live') {
        host.dispatchEvent(new CustomEvent(data.type, { detail: data }));
      }
    };
    window.addEventListener('message', onMessage);
    host.replaceChildren(iframe);

    this.setTheme = (theme) => {
      config.theme = theme;
      iframe.contentWindow?.postMessage({ type: 'board-theme', theme }, targetOrigin);
    };
    this.destroy = () => {
      window.removeEventListener('message', onMessage);
      iframe.remove();
    };
  }

  window.BoardAPI = { Editor };
})();
