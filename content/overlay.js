(function () {
  if (window.__ankiCaptureContentLoaded) return;
  window.__ankiCaptureContentLoaded = true;

  const TOOLBAR_ID = 'anki-capture-toolbar';
  let toolbarVisible = false;
  let activeMode = null;
  let selectionListenerAttached = false;

  function ensureToolbar() {
    let toolbar = document.getElementById(TOOLBAR_ID);
    if (toolbar) return toolbar;
    
    toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.className = 'anki-capture-toolbar';
    toolbar.innerHTML = `
      <div class="anki-capture-toolbar__title">Capture Mode Active</div>
      <div class="anki-capture-toolbar__actions">
        <button type="button" class="anki-capture-toolbar__button" data-mode="text">Text Selection</button>
        <button type="button" class="anki-capture-toolbar__button" data-mode="area">Area Selection</button>
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

  function showToolbar() {
    ensureToolbar().style.display = 'block';
    toolbarVisible = true;
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

    await chrome.runtime.sendMessage({
      type: 'capture-text',
      selectedText,
      pageTitle: document.title,
      pageUrl: window.location.href,
      timestamp: new Date().toISOString()
    });
    hideToolbar();
  }

  // FIXED: Restored the missing text listener function
  function attachSelectionListener() {
    if (selectionListenerAttached) return;

    document.addEventListener('mouseup', () => {
      if (!toolbarVisible || activeMode !== 'text') return;
      captureTextSelection();
    });

    selectionListenerAttached = true;
  }

  function setMode(mode) {
    activeMode = mode;
    if (mode === 'text') { attachSelectionListener(); return; }
    if (mode === 'area') {
      window.dispatchEvent(new CustomEvent('anki-capture-mode', { detail: { mode: 'area' } }));
      return;
    }
    if (mode === 'cancel') {
      window.dispatchEvent(new CustomEvent('anki-capture-mode', { detail: { mode: 'cancel' } }));
      hideToolbar();
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'capture-start') {
      showToolbar();
      attachSelectionListener();
    }
  });
})();