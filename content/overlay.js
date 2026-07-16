(function () {
  if (window.__ankiCaptureContentLoaded) return;
  window.__ankiCaptureContentLoaded = true;

  const TOOLBAR_ID = 'anki-capture-toolbar';
  let toolbarVisible = false;
  let activeMode = null;
  let selectionListenerAttached = false;
  let lastCapturedText = '';
  let lastCapturedAt = 0;

  function ensureToolbar() {
    let toolbar = document.getElementById(TOOLBAR_ID);
    if (toolbar) return toolbar;
    
    toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.className = 'anki-capture-toolbar';
    toolbar.innerHTML = `
      <div class="anki-capture-toolbar__title">Capture Mode Active</div>
      <div class="anki-capture-toolbar__status" data-status>Choose text or area.</div>
      <div class="anki-capture-toolbar__actions">
        <button type="button" class="anki-capture-toolbar__button" data-mode="text">Text</button>
        <button type="button" class="anki-capture-toolbar__button" data-mode="area">Area</button>
        <button type="button" class="anki-capture-toolbar__button" data-mode="cancel">Cancel</button>
      </div>
    `;

    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-mode]');
      if (!button) return;
      setMode(button.getAttribute('data-mode'));
    });

    document.body.appendChild(toolbar);
    return toolbar;
  }

  function setToolbarStatus(message) {
    const toolbar = ensureToolbar();
    const status = toolbar.querySelector('[data-status]');
    if (status) status.textContent = message;
  }

  function showToolbar() {
    ensureToolbar().style.display = 'block';
    toolbarVisible = true;
    setToolbarStatus('Choose text or area.');
  }

  function hideToolbar() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (toolbar) toolbar.style.display = 'none';
    toolbarVisible = false;
    activeMode = null;
  }

  async function captureTextSelection() {
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';
    if (!selectedText) return;

    const now = Date.now();
    if (selectedText === lastCapturedText && now - lastCapturedAt < 1000) return;
    lastCapturedText = selectedText;
    lastCapturedAt = now;

    await chrome.runtime.sendMessage({
      type: 'capture-text',
      selectedText,
      pageTitle: document.title,
      pageUrl: window.location.href,
      timestamp: new Date().toISOString()
    });

    if (selection) selection.removeAllRanges();
    activeMode = null;
    setToolbarStatus('Text captured. Choose another capture or cancel.');
  }

  function handleSelectionMouseup() {
    if (!toolbarVisible || activeMode !== 'text') return;
    captureTextSelection();
  }

  function attachSelectionListener() {
    if (selectionListenerAttached) return;

    document.addEventListener('mouseup', handleSelectionMouseup);
    selectionListenerAttached = true;
  }

  function setMode(mode) {
    activeMode = mode;
    if (mode === 'text') {
      attachSelectionListener();
      setToolbarStatus('Highlight text on the page.');
      return;
    }
    if (mode === 'area') {
      setToolbarStatus('Drag an area to capture.');
      window.dispatchEvent(new CustomEvent('anki-capture-mode', { detail: { mode: 'area' } }));
      return;
    }
    if (mode === 'cancel') {
      window.dispatchEvent(new CustomEvent('anki-capture-mode', { detail: { mode: 'cancel' } }));
      hideToolbar();
    }
  }

  window.addEventListener('keydown', (event) => {
    if (!toolbarVisible) return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;

    if (event.key === 'Escape') {
      setMode('cancel');
    } else if (event.key.toLowerCase() === 't') {
      setMode('text');
    } else if (event.key.toLowerCase() === 'a') {
      setMode('area');
    }
  });

  window.addEventListener('anki-capture-complete', (event) => {
    activeMode = null;
    const mode = event.detail?.mode || 'selection';
    setToolbarStatus(`${mode === 'area' ? 'Area' : 'Selection'} captured. Choose another capture or cancel.`);
  });

  window.addEventListener('anki-capture-error', (event) => {
    activeMode = null;
    setToolbarStatus(event.detail?.error || 'Capture failed. Try again.');
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'capture-start') {
      showToolbar();
      attachSelectionListener();
    }
  });
})();
