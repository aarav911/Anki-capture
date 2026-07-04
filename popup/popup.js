const statusPill = document.getElementById('status-pill');
const statusMessage = document.getElementById('status-message');
const errorBox = document.getElementById('error-box');
const deckSelect = document.getElementById('deck-select');
const newDeckName = document.getElementById('new-deck-name');
const createDeckButton = document.getElementById('create-deck-button');
const addNoteButton = document.getElementById('add-note-button');

function setConnectedState(connected, message) {
  statusPill.className = 'status-pill';
  if (connected) {
    statusPill.textContent = 'Connected to Anki';
    statusPill.classList.add('status-connected');
    statusMessage.textContent = message || 'Ready to manage decks.';
    deckSelect.disabled = false;
    newDeckName.disabled = false;
    createDeckButton.disabled = false;
    addNoteButton.disabled = false;
  } else {
    statusPill.textContent = 'Disconnected';
    statusPill.classList.add('status-error');
    statusMessage.textContent = message || 'AnkiConnect not detected.';
    deckSelect.disabled = true;
    newDeckName.disabled = true;
    createDeckButton.disabled = true;
    addNoteButton.disabled = true;
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

function populateDecks(decks) {
  deckSelect.innerHTML = '';
  decks.forEach((deck) => {
    const option = document.createElement('option');
    option.value = deck;
    option.textContent = deck;
    deckSelect.appendChild(option);
  });
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

async function checkConnection() {
  clearError();
  setConnectedState(false, 'Checking connection…');
  try {
    const decks = await sendToBackground({ type: 'anki-ping' });
    populateDecks(decks);
    setConnectedState(true, 'Connected to Anki.');
  } catch (error) {
    showError('AnkiConnect not detected. Please open Anki and ensure AnkiConnect is installed.');
    setConnectedState(false, error.message);
  }
}

async function refreshDecks() {
  try {
    const decks = await sendToBackground({ type: 'anki-get-decks' });
    populateDecks(decks);
    setConnectedState(true, 'Decks refreshed.');
  } catch (error) {
    showError('Unable to refresh decks.');
    setConnectedState(false, error.message);
  }
}

createDeckButton.addEventListener('click', async () => {
  const deckName = newDeckName.value.trim();
  if (!deckName) {
    showError('Please enter a deck name.');
    return;
  }

  try {
    clearError();
    await sendToBackground({ type: 'anki-create-deck', deckName });
    newDeckName.value = '';
    await refreshDecks();
    deckSelect.value = deckName;
  } catch (error) {
    showError(error.message || 'Unable to create deck.');
  }
});

addNoteButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    await sendToBackground({
      type: 'capture-start',
      tabId: tab.id
    });

    window.close(); // closes the popup

  } catch (error) {
    showError(error.message || 'Unable to start capture mode.');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  checkConnection();
});
