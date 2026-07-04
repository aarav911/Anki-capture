const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9876;
const DATASET_FILE = path.resolve(__dirname, 'anki_capture_dataset.json');

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

function loadDataset() {
  try {
    if (!fs.existsSync(DATASET_FILE)) {
      return [];
    }
    const text = fs.readFileSync(DATASET_FILE, 'utf8');
    if (!text.trim()) {
      return [];
    }
    return JSON.parse(text);
  } catch (error) {
    console.error('Failed to read dataset file:', error);
    return [];
  }
}

function saveDataset(dataset) {
  try {
    fs.writeFileSync(DATASET_FILE, JSON.stringify(dataset, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write dataset file:', error);
    throw error;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/append') {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    try {
      const entry = JSON.parse(body);
      const dataset = loadDataset();
      dataset.push(entry);
      saveDataset(dataset);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Invalid JSON' });
    }
  });

  req.on('error', (error) => {
    sendJson(res, 500, { ok: false, error: error.message || 'Server error' });
  });
});

server.listen(PORT, () => {
  console.log(`Dataset append server running at http://127.0.0.1:${PORT}`);
  console.log(`Appending entries to ${DATASET_FILE}`);
});
