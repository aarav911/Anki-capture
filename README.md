# Anki Capture Extension

Anki Capture is a lightweight, high-performance Chrome Extension designed to streamline your flashcard creation workflow. It allows you to instantly extract text selections or snip custom screen regions directly from your browser and load them into a dedicated card editor that syncs with Anki via AnkiConnect.

## Features

* **Text Capture Mode**: Highlight any text on a webpage, and it will be sent straight into the `Back` field of a new card, automatically formatted with source attribution (Page Title and URL).
* **Area Selection (Snipping)**: Drag and drop a selection box over any visual on the screen. The extension crops the region perfectly—even handling High-DPI/Retina screen pixel densities—and embeds the image directly into your card preview.
* **Integrated Note Editor**: Review, modify, add tags, select target decks, and customize the `Front` or `Back` of your cards in a dedicated popup window before pushing them to Anki.
* **Local Dataset Archiving**: Automatically appends an entry of your captures to a local server backend for data backup or custom parsing.

---

## Architecture Overview

The extension is modularly split across four key script layers to adhere to Chrome's Manifest V3 security standards:


```

├── content/
│   ├── content.js        # Handles the global injection, UI toolbar toggle, and text listeners
│   ├── overlay.js        # UI layer rendering the interactive area-selection snipping frame
│   └── overlay.css       # Visual styles for the drawing box overlay
├── background.js         # The Service Worker background script coordinating APIs and state
└── popup/
├── editor.html       # The card review user interface window
└── editor.js         # Manages input formatting, asset injection, and Anki Connect integration

```

---

## Prerequisites

Before utilizing the extension, make sure you have the following active configuration:
1. **Anki Desktop** application installed and running locally.
2. The **AnkiConnect** add-on installed inside Anki (Add-on ID: `8765`).
3. (Optional) A local dataset storage server running at `http://127.0.0.1:9876/append` to receive automated data logs.

---

## Installation

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** by toggling the switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner and select the root directory containing the extension files.

---

## How It Works

### Step 1: Initialize Capture
Trigger the extension via its action popup or shortcut. The action fires a `capture-start` instruction to the active background worker which injects the toolbar on the page.

### Step 2: Select Your Mode
* **Text Selection**: Click the option on the toolbar, then highlight any text on the page. On release (`mouseup`), the text is compiled and saved.
* **Area Selection**: Click the option to launch the transparent overlay canvas layer. Drag across the interface to select a visual frame. The system registers the coordinates scaled properly against your monitor's `devicePixelRatio`.

### Step 3: Edit and Sync
The background service worker fires a crisp `chrome.tabs.captureVisibleTab` screen snap (for area mode), processes it inside an automated `OffscreenCanvas` environment, saves the snapshot to local storage, and pops open the Note Editor window. Fill in your fields, select a deck, and hit **Add Note** to sync instantly with Anki.

---

## API & Message References

The extension coordinates internal workflows using `chrome.runtime.sendMessage` protocols:

| Message Type | Scope | Description |
| :--- | :--- | :--- |
| `capture-start` | Popup $\rightarrow$ Content | Spawns the main interactions option menu bar overlay |
| `capture-text` | Content $\rightarrow$ Background | Packs string highlights with page metadata parameters |
| `capture-area-selection` | Overlay $\rightarrow$ Background | Sends scaled canvas dimensions to request a visible tab crop |
| `anki-get-decks` | Editor $\rightarrow$ Background | Requests active deck collection configurations out of AnkiConnect |
| `anki-add-note` | Editor $\rightarrow$ Background | Compiles final payload fields to execute `addNote` in Anki |


