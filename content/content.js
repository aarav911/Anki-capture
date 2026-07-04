(function () {
  if (window.__ankiCaptureOverlayLoaded) return;
  window.__ankiCaptureOverlayLoaded = true;

  let overlay = null;
  let selectionBox = null;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let isDrawing = false;
  let listenersAttached = false;

  function createOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'anki-capture-overlay';
    overlay.className = 'anki-capture-overlay';

    selectionBox = document.createElement('div');
    selectionBox.id = 'anki-capture-selection';
    selectionBox.className = 'anki-capture-selection';

    overlay.appendChild(selectionBox);
    document.body.appendChild(overlay);
    return overlay;
  }

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      selectionBox = null;
    }
    removeSelectionListeners();
  }

  function updateSelectionBox() {
    if (!selectionBox) return;
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);

    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
    selectionBox.style.display = width > 0 && height > 0 ? 'block' : 'none';
  }

  function attachSelectionListeners() {
    if (listenersAttached) return;
    window.addEventListener('mousemove', moveSelection);
    window.addEventListener('mouseup', finishSelection);
    listenersAttached = true;
  }

  function removeSelectionListeners() {
    window.removeEventListener('mousemove', moveSelection);
    window.removeEventListener('mouseup', finishSelection);
    listenersAttached = false;
  }

  function startSelection(event) {
    event.preventDefault();
    isDrawing = true;
    startX = event.clientX;
    startY = event.clientY;
    currentX = startX;
    currentY = startY;
    createOverlay();
    overlay.style.display = 'block';
    updateSelectionBox();
  }

  function moveSelection(event) {
    if (!isDrawing) return;
    currentX = event.clientX;
    currentY = event.clientY;
    updateSelectionBox();
  }

  async function finishSelection(event) {
    if (!isDrawing) return;
    isDrawing = false;
    currentX = event.clientX;
    currentY = event.clientY;
    updateSelectionBox();

    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    if (width < 5 || height < 5) {
      removeOverlay();
      return;
    }

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    
    const dpr = window.devicePixelRatio || 1;
    const selection = {
      x: x * dpr,
      y: y * dpr,
      width: width * dpr,
      height: height * dpr
    };

    // Crucial: Hide overlay DOM structure cleanly BEFORE the screenshot triggers
    removeOverlay();

    // A brief execution pause guarantees browser layout rendering completes before capturing
    setTimeout(async () => {
      const capturedData = await chrome.runtime.sendMessage({
        type: 'capture-area-selection',
        selection,
        pageTitle: document.title,
        pageUrl: window.location.href,
        timestamp: new Date().toISOString()
      });

      if (capturedData?.ok) {
        console.log("Response complete:", capturedData.data);
      } else {
        console.error("Capture failed:", capturedData?.error);
      }
    }, 50);
  }

  function enableAreaSelection() {
    const overlayElement = createOverlay();
    overlayElement.style.display = 'block';
    attachSelectionListeners();
    overlayElement.addEventListener('mousedown', startSelection);
  }

  function disableAreaSelection() {
    removeOverlay();
    isDrawing = false;
  }

  window.addEventListener('anki-capture-mode', (event) => {
    const mode = event.detail?.mode;
    if (mode === 'area') {
      enableAreaSelection();
    } else if (mode === 'cancel') {
      disableAreaSelection();
    }
  });
})();