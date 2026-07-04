const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';
const CAPTURE_STORAGE_KEY = 'ankiCaptureData';
const DATA_SERVER_URL = 'http://127.0.0.1:9876/append';

async function requestAnki(payload) {
  const response = await fetch(ANKI_CONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect request failed with status ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
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
  } catch (error) {
    console.warn('Unable to append dataset entry to local file:', error.message);
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
  const canvas = new OffscreenCanvas(selection.width, selection.height);
  const context = canvas.getContext('2d');

  context.drawImage(
    imageBitmap,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    0,
    0,
    selection.width,
    selection.height
  );

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await croppedBlob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  const base64 = btoa(binary);
  return `data:image/png;base64,${base64}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleMessage = async () => {
    try {
      switch (message.type) {
        case 'anki-ping': {
          const decks = await requestAnki({ action: 'deckNames', version: 6 });
          sendResponse({ ok: true, data: decks });
          return;
        }
        case 'anki-get-decks': {
          const decks = await requestAnki({ action: 'deckNames', version: 6 });
          sendResponse({ ok: true, data: decks });
          return;
        }
        case 'anki-create-deck': {
          const result = await requestAnki({
            action: 'createDeck',
            version: 6,
            params: { deck: message.deckName }
          });
          sendResponse({ ok: true, data: result });
          return;
        }
        case 'anki-add-note': {
          const captureData = await getCaptureData();
          await requestAnki({
            action: 'addNote',
            version: 6,
            params: { note: message.note }
          });

          if (captureData) {
            const datasetEntry = {
              input: captureData,
              output: {
                deckName: message.note.deckName,
                modelName: message.note.modelName,
                fields: message.note.fields,
                tags: message.note.tags || []
              },
              addedAt: new Date().toISOString()
            };
            await sendDatasetEntryToLocalFile(datasetEntry);
          }

          sendResponse({ ok: true, data: null });
          return;
        }
        case 'capture-start': {
          if (message.tabId === undefined) {
            throw new Error('No active tab was provided.');
          }
          await ensureContentReady(message.tabId);
          await chrome.tabs.sendMessage(message.tabId, { type: 'capture-start', mode: 'toolbar' });
          sendResponse({ ok: true, data: null });
          return;
        }
        case 'capture-text': {
          const captureData = {
            selectedText: message.selectedText,
            pageTitle: message.pageTitle,
            pageUrl: message.pageUrl,
            timestamp: message.timestamp,
            type: 'text'
          };
          await saveCaptureData(captureData);
          await openEditorWindow();
          sendResponse({ ok: true, data: null });
          return;
        }
        case 'capture-image': {
          const captureData = {
            imageData: message.imageData,
            imageAlt: message.imageAlt,
            pageTitle: message.pageTitle,
            pageUrl: message.pageUrl,
            timestamp: message.timestamp,
            type: 'image'
          };
          await saveCaptureData(captureData);
          await openEditorWindow();
          sendResponse({ ok: true, data: null });
          return;
        }
        case 'capture-area-selection': {
          const tabId = sender.tab?.id;
          if (!tabId) {
            throw new Error('Active tab not found.');
          }
          const dataUrl = await chrome.tabs.captureVisibleTab(tabId, { format: 'png' });
          const imageData = await cropImageRegion(dataUrl, message.selection);
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
          return;
        }
        case 'get-capture-data': {
          const data = await getCaptureData();
          sendResponse({ ok: true, data });
          return;
        }
        case 'clear-capture-data': {
          await clearCaptureData();
          sendResponse({ ok: true, data: null });
          return;
        }
        default:
          throw new Error(`Unsupported message type: ${message.type}`);
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  };

  handleMessage();
  return true;
});
