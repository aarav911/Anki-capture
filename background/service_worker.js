const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';
const CAPTURE_STORAGE_KEY = 'ankiCaptureData';
const DATA_SERVER_URL = 'http://127.0.0.1:9876/append';

async function requestAnki(payload) {
  const response = await fetch(ANKI_CONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`AnkiConnect status ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function saveCaptureData(data) {
  await chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: data });
}

async function clearCaptureData() {
  await chrome.storage.local.remove(CAPTURE_STORAGE_KEY);
}

async function getCaptureData() {
  const result = await chrome.storage.local.get(CAPTURE_STORAGE_KEY);
  return result[CAPTURE_STORAGE_KEY] || null;
}

async function sendDatasetEntryToLocalFile(entry) {
  try {
    await fetch(DATA_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
  } catch (e) {
    console.warn('Unable to append dataset entry:', e.message);
  }
}

async function openEditorWindow() {
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup/editor.html'),
    type: 'popup',
    width: 640,
    height: 760,
    focused: true
  });
}

async function ensureContentReady(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/overlay.js'] });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/overlay.css'] });
}

async function cropImageRegion(dataUrl, selection) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  
  const width = Math.max(1, Math.floor(selection.width));
  const height = Math.max(1, Math.floor(selection.height));
  
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');

  context.drawImage(
    imageBitmap,
    Math.floor(selection.x),
    Math.floor(selection.y),
    width,
    height,
    0,
    0,
    width,
    height
  );

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await croppedBlob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  bytes.forEach(b => binary += String.fromCharCode(b));
  return `data:image/png;base64,${btoa(binary)}`;
}

// Fixed Router Framework: Natively wraps the runtime context to cleanly pass asynchronous messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'anki-ping' || message.type === 'anki-get-decks') {
    requestAnki({ action: 'deckNames', version: 6 })
      .then(decks => sendResponse({ ok: true, data: decks }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'anki-create-deck') {
    requestAnki({ action: 'createDeck', version: 6, params: { deck: message.deckName } })
      .then(res => sendResponse({ ok: true, data: res }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'anki-add-note') {
    (async () => {
      const captureData = await getCaptureData();
      await requestAnki({ action: 'addNote', version: 6, params: { note: message.note } });
      if (captureData) {
        await sendDatasetEntryToLocalFile({
          input: captureData,
          output: {
            deckName: message.note.deckName,
            modelName: message.note.modelName,
            fields: message.note.fields,
            tags: message.note.tags || []
          },
          addedAt: new Date().toISOString()
        });
      }
      sendResponse({ ok: true, data: null });
    })().catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'capture-start') {
    if (message.tabId === undefined) {
      sendResponse({ ok: false, error: 'No active tab provided.' });
      return;
    }
    ensureContentReady(message.tabId)
      .then(() => chrome.tabs.sendMessage(message.tabId, { type: 'capture-start', mode: 'toolbar' }))
      .then(() => sendResponse({ ok: true, data: null }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'capture-text') {
    const captureData = {
      selectedText: message.selectedText,
      pageTitle: message.pageTitle,
      pageUrl: message.pageUrl,
      timestamp: message.timestamp,
      type: 'text'
    };
    saveCaptureData(captureData)
      .then(openEditorWindow)
      .then(() => sendResponse({ ok: true, data: null }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  

  if (message.type === 'capture-area-selection') {
    const windowId = sender.tab?.windowId;
    if (!windowId) {
      sendResponse({ ok: false, error: 'Active window structure mapping missing.' });
      return;
    }
    
    // Executes image assembly synchronously down the data path stream
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      .then(dataUrl => cropImageRegion(dataUrl, message.selection))
      .then(async (imageData) => {
        const captureData = {
          imageData,
          x: message.selection.x,
          y: message.selection.y,
          width: message.selection.width,
          height: message.selection.height,
          pageTitle: message.pageTitle,
          pageUrl: message.pageUrl,
          timestamp: message.timestamp,
          type: 'area'
        };
        await saveCaptureData(captureData);
        await openEditorWindow();
        sendResponse({ ok: true, data: captureData });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'get-capture-data') {
    getCaptureData()
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'clear-capture-data') {
    clearCaptureData()
      .then(() => sendResponse({ ok: true, data: null }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});