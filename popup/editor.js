const statusPill = document.getElementById('status-pill');
const statusMessage = document.getElementById('capture-summary');
const errorBox = document.getElementById('error-box');
const deckSelect = document.getElementById('deck-select');
const noteTypeSelect = document.getElementById('note-type-select');
const tagsInput = document.getElementById('tags-input');
const frontField = document.getElementById('front-field');
const backField = document.getElementById('back-field');
const imagePreviewContainer = document.getElementById('image-preview-container');
const captureMoreButton = document.getElementById('capture-more-button');
const addNoteButton = document.getElementById('add-note-button');
const clearButton = document.getElementById('clear-button');
const closeButton = document.getElementById('close-button');

let captureDataList = [];

function setConnectedState(connected, message) {
  statusPill.className = 'status-pill';
  if (connected) {
    statusPill.textContent = 'Connected to Anki';
    statusPill.classList.add('status-connected');
    statusMessage.textContent = message || 'Ready to create a card.';
    deckSelect.disabled = false;
    captureMoreButton.disabled = false;
    addNoteButton.disabled = false;
    clearButton.disabled = false;
  } else {
    statusPill.textContent = 'Disconnected';
    statusPill.classList.add('status-error');
    statusMessage.textContent = message || 'AnkiConnect not detected.';
    deckSelect.disabled = true;
    captureMoreButton.disabled = false;
    addNoteButton.disabled = true;
    clearButton.disabled = false;
  }
}

function showError(message) {
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

async function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.ok === false) {
        reject(new Error(response?.error || 'Background command failed.'));
        return;
      }
      resolve(response.data);
    });
  });
}

async function loadDecks() {
  try {
    const decks = await sendToBackground({ type: 'anki-get-decks' });
    deckSelect.innerHTML = '';
    decks.forEach((deck) => {
      const option = document.createElement('option');
      option.value = deck;
      option.textContent = deck;
      deckSelect.appendChild(option);
    });

    const { currentDeck } = await chrome.storage.session.get(['currentDeck']);
    if (currentDeck && Array.from(deckSelect.options).some(option => option.value === currentDeck)) {
      deckSelect.value = currentDeck;
    }

    setConnectedState(true, 'Connected to Anki.');
  } catch (error) {
    showError('AnkiConnect not detected. Please open Anki and ensure AnkiConnect is installed.');
    setConnectedState(false, error.message);
  }
}

function buildCaptureId(capture) {
  return [
    capture.type || 'capture',
    capture.timestamp || '',
    capture.pageUrl || '',
    capture.selectedText || '',
    capture.imageData ? capture.imageData.slice(0, 64) : ''
  ].join('|');
}

function clearRenderedCaptures() {
  backField.value = '';
  imagePreviewContainer.innerHTML = '';
  imagePreviewContainer.hidden = true;
}

function processAndAppendCapture(capture) {
  if (!capture) return;

  if (!frontField.value && capture.pageTitle) {
    frontField.value = capture.pageTitle;
  }

  if (capture.type === 'text') {
    const standardTextFormat = [
      capture.selectedText
    ].filter(Boolean).join('\n\n') + '\n\n';
    backField.value += standardTextFormat;
    statusMessage.textContent = 'Appended text capture to note.';
    return;
  }

  if (capture.type === 'area' || capture.type === 'image' || capture.imageData) {
    const imageHtmlFormat = [
      `<div><img src="${capture.imageData}" alt="Snipped capture" style="max-width:100%;"></div>`
    ].filter(Boolean).join('\n\n') + '\n\n';
    backField.value += imageHtmlFormat;
    
    const imgWrapper = document.createElement('div');
    imgWrapper.style.margin = '5px 0';
    imgWrapper.style.border = '1px solid #ccc';
    imgWrapper.style.borderRadius = '8px';
    imgWrapper.style.overflow = 'hidden';
    
    const newImg = document.createElement('img');
    newImg.src = capture.imageData;
    newImg.style.maxWidth = '100%';
    newImg.style.display = 'block';
    
    imgWrapper.appendChild(newImg);
    imagePreviewContainer.appendChild(imgWrapper);
    imagePreviewContainer.hidden = false;

    statusMessage.textContent = 'Appended area selection capture to note.';
  }
}

function renderCaptureData(captures) {
  captureDataList = Array.isArray(captures) ? captures.filter(Boolean) : (captures ? [captures] : []);
  clearRenderedCaptures();

  captureDataList.forEach(capture => {
    processAndAppendCapture(capture);
  });

  if (captureDataList.length === 0) {
    statusMessage.textContent = 'Capture text or an image from a page to start this card.';
    return;
  }

  statusMessage.textContent = `Loaded ${captureDataList.length} capture${captureDataList.length === 1 ? '' : 's'} into this card.`;
}

function appendLiveCapture(capture) {
  if (!capture) return;

  const existingIds = new Set(captureDataList.map(buildCaptureId));
  const captureId = buildCaptureId(capture);
  if (existingIds.has(captureId)) return;

  captureDataList.push(capture);
  processAndAppendCapture(capture);
  statusMessage.textContent = `Added capture ${captureDataList.length}.`;
}

async function loadCaptureData() {
  try {
    const captures = await sendToBackground({ type: 'get-capture-data' });
    renderCaptureData(captures);
  } catch (error) {
    showError('Unable to load captured content.');
  }
}

async function addNote() {
  clearError();
  const deckName = deckSelect.value;
  const modelName = noteTypeSelect.value;
  const tags = tagsInput.value.trim().split(/\s+/).filter(Boolean);
  const front = frontField.value.trim();
  const back = backField.value.trim();

  if (!front) { showError('The front field cannot be empty.'); return; }
  if (!back) { showError('The back field cannot be empty.'); return; }

  try {
    addNoteButton.innerHTML = "Adding..";
    addNoteButton.disabled = true;
    
    await sendToBackground({
      type: 'anki-add-note',
      note: {
        deckName,
        modelName,
        fields: { Front: front, Back: back },
        tags
      }
    });

    await sendToBackground({ type: 'clear-capture-data' });
    statusMessage.textContent = 'Note added successfully.';
    setTimeout(() => window.close(), 500);
  } catch (error) {
    showError(error.message || 'Unable to add note.');
    addNoteButton.innerHTML = "Add Note";
    addNoteButton.disabled = false;
  }
}

async function captureMore() {
  clearError();
  try {
    await sendToBackground({ type: 'capture-more' });
    statusMessage.textContent = 'Capture toolbar reopened on the source page.';
    window.blur();
  } catch (error) {
    showError(error.message || 'Unable to restart capture mode.');
  }
}

async function clearCapture() {
  captureDataList = [];
  frontField.value = '';
  backField.value = '';
  tagsInput.value = '';
  imagePreviewContainer.hidden = true;
  imagePreviewContainer.innerHTML = '';
  statusMessage.textContent = 'Capture cleared. You can create a note manually.';
  await sendToBackground({ type: 'clear-capture-data' });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'capture-data-updated') {
    if (message.latestCapture) {
      appendLiveCapture(message.latestCapture);
    } else if (Array.isArray(message.captures)) {
      renderCaptureData(message.captures);
    }
    window.focus();
  }
});

closeButton.addEventListener('click', async () => {
  await sendToBackground({ type: 'close-editor' });
  window.close();
});

window.addEventListener('unload', () => {
  chrome.runtime.sendMessage({ type: 'close-editor' });
});

deckSelect.addEventListener('change', async (event) => {
  await chrome.storage.session.set({ currentDeck: event.target.value });
});

captureMoreButton.addEventListener('click', captureMore);
addNoteButton.addEventListener('click', addNote);
clearButton.addEventListener('click', clearCapture);

document.addEventListener('DOMContentLoaded', async () => {
  await loadDecks();
  await loadCaptureData();
});
