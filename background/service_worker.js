const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';
const CAPTURE_STORAGE_KEY = 'ankiCaptureData';
const DATA_SERVER_URL = 'http://127.0.0.1:9876/append';

let editorOpen = false;
let editorWindowId = null;
let activeCaptureTabId = null;

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

async function appendCaptureData(newEntry) {
  const currentData = await getCaptureData();
  currentData.push(newEntry);
  await chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: currentData });
  return currentData;
}

function normalizeCaptureData(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'object') return [value];
  return [];
}

async function getCaptureData() {
  const result = await chrome.storage.local.get(CAPTURE_STORAGE_KEY);
  const normalizedData = normalizeCaptureData(result[CAPTURE_STORAGE_KEY]);

  if (result[CAPTURE_STORAGE_KEY] && !Array.isArray(result[CAPTURE_STORAGE_KEY])) {
    await chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: normalizedData });
  }

  return normalizedData;
}

async function clearCaptureData() {
  await chrome.storage.local.remove(CAPTURE_STORAGE_KEY);
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
  if (editorOpen && editorWindowId !== null) {
    try {
      await chrome.windows.update(editorWindowId, { focused: true });
      return;
    } catch (error) {
      closeEditorState();
    }
  }

  editorOpen = true;
  const editorWindow = await chrome.windows.create({
    url: chrome.runtime.getURL('popup/editor.html'),
    type: 'popup',
    width: 640,
    height: 760,
    focused: true
  });
  editorWindowId = editorWindow.id || null;
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
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

async function startCapture(tabId) {
  if (tabId === undefined) {
    throw new Error('No active tab provided.');
  }

  activeCaptureTabId = tabId;
  await ensureContentReady(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'capture-start', mode: 'toolbar' });
}

async function startCaptureInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found.');
  }

  await startCapture(tab.id);
}

async function notifyEditor(latestCapture, captures) {
  await openEditorWindow();

  try {
    await chrome.runtime.sendMessage({
      type: 'capture-data-updated',
      latestCapture,
      captures
    });
  } catch (error) {
    console.warn('Editor update message was not received:', error.message);
  }
}

function closeEditorState() {
  editorOpen = false;
  editorWindowId = null;
}

function makeMediaFilename(index) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `anki-capture-${Date.now()}-${index}-${randomPart}.png`;
}

async function replaceDataImagesWithAnkiMedia(html) {
  if (!html || !html.includes('data:image/')) {
    return html;
  }

  let imageIndex = 0;
  const imagePattern = /<img([^>]*?)src="data:image\/png;base64,([^"]+)"([^>]*)>/g;
  const replacements = [];
  let match;

  while ((match = imagePattern.exec(html)) !== null) {
    const filename = makeMediaFilename(imageIndex);
    imageIndex += 1;
    replacements.push({
      original: match[0],
      updated: `<img${match[1]}src="${filename}"${match[3]}>`,
      filename,
      data: match[2]
    });
  }

  for (const replacement of replacements) {
    await requestAnki({
      action: 'storeMediaFile',
      version: 6,
      params: {
        filename: replacement.filename,
        data: replacement.data
      }
    });
    html = html.replace(replacement.original, replacement.updated);
  }

  return html;
}

async function prepareNoteForAnki(note) {
  const preparedNote = {
    ...note,
    fields: {
      ...note.fields
    }
  };

  preparedNote.fields.Back = await replaceDataImagesWithAnkiMedia(preparedNote.fields.Back);
  preparedNote.fields.Front = await replaceDataImagesWithAnkiMedia(preparedNote.fields.Front);
  return preparedNote;
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'start-capture') return;
  startCaptureInActiveTab().catch((error) => {
    console.error('Unable to start Anki Capture from shortcut:', error);
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === editorWindowId) {
    closeEditorState();
  }
});

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
      const captureDataList = await getCaptureData();
      const note = await prepareNoteForAnki(message.note);
      await requestAnki({ action: 'addNote', version: 6, params: { note } });
      
      // Dataset payload handles the historical log of captured data context
      if (captureDataList.length > 0) {
        await sendDatasetEntryToLocalFile({
          input: captureDataList, 
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
    startCapture(message.tabId)
      .then(() => sendResponse({ ok: true, data: null }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'capture-more') {
    const tabId = message.tabId || activeCaptureTabId;
    startCapture(tabId)
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
    appendCaptureData(captureData)
      .then(captures => notifyEditor(captureData, captures).then(() => captures))
      .then(captures => sendResponse({ ok: true, data: captures }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'capture-area-selection') {
    const windowId = sender.tab?.windowId;
    if (!windowId) {
      sendResponse({ ok: false, error: 'Active window structure mapping missing.' });
      return;
    }
    
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      .then(dataUrl => cropImageRegion(dataUrl, message.selection))
      .then(async (imageData) => {
        const newEntry = {
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

        const fullDataset = await appendCaptureData(newEntry);
        await notifyEditor(newEntry, fullDataset);
        sendResponse({ ok: true, data: fullDataset });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'close-editor') {
    closeEditorState();
    sendResponse({ ok: true, data: null });
    return;
  }

  if (message.type === 'get-capture-data') {
    getCaptureData()
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'clear-capture-data') {
    clearCaptureData()
      .then(() => sendResponse({ ok: true, data: [] }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
