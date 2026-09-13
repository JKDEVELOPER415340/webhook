const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try { return { ...state.config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch (e) { return state.config; }
}

function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(state.config, null, 2)); }
  catch (e) { console.error('Failed to save config:', e.message); }
}

const state = {
  config: {
    verifyToken: '',
    appSecret: '',
    destinationUrl: '',
    autoStart: false
  },
  logs: [],
  forwarding: false,
  startedAt: null
};

state.config = loadConfig();

const MAX_LOGS = 500;

function addLog(type, message, body) {
  state.logs.unshift({ id: crypto.randomUUID(), type, message, body: body || null, time: new Date().toISOString() });
  if (state.logs.length > MAX_LOGS) state.logs.length = MAX_LOGS;
}

function verifySignature(req) {
  const { appSecret } = state.config;
  if (!appSecret) return true;
  const signature = req.get('x-hub-signature-256');
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  try {
    const received = Buffer.from(signature.split('=')[1], 'hex');
    const computed = Buffer.from(expected.split('=')[1], 'hex');
    return received.length === computed.length && crypto.timingSafeEqual(received, computed);
  } catch (e) {
    return false;
  }
}

function validChallenge(req) {
  return req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === state.config.verifyToken &&
    typeof req.query['hub.challenge'] === 'string' && req.query['hub.challenge'].length > 0;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, forwarding: state.forwarding });
});

app.get('/api/config', (req, res) => {
  const { appSecret, ...safe } = state.config;
  res.json({ ...safe, appSecretSet: Boolean(appSecret) });
});

app.post('/api/config', (req, res) => {
  const { verifyToken, appSecret, destinationUrl, autoStart } = req.body || {};
  if (typeof verifyToken === 'string') state.config.verifyToken = verifyToken;
  if (typeof appSecret === 'string') state.config.appSecret = appSecret;
  if (typeof destinationUrl === 'string') state.config.destinationUrl = destinationUrl;
  if (typeof autoStart === 'boolean') state.config.autoStart = autoStart;

  saveConfig();
  addLog('info', 'Configuration updated');
  res.json({ config: { ...state.config, appSecretSet: Boolean(state.config.appSecret) } });
});

app.post('/api/start', (req, res) => {
  if (!state.config.destinationUrl) {
    addLog('error', 'Cannot start: no destination URL configured');
    return res.status(400).json({ error: 'Set a destination URL before starting forwarding' });
  }
  state.forwarding = true;
  state.startedAt = new Date().toISOString();
  addLog('info', `Forwarding started to ${state.config.destinationUrl}`);
  res.json({ forwarding: true, startedAt: state.startedAt });
});

app.post('/api/stop', (req, res) => {
  state.forwarding = false;
  state.startedAt = null;
  addLog('info', 'Forwarding stopped');
  res.json({ forwarding: false });
});

app.get('/api/logs', (req, res) => {
  res.json({ logs: state.logs });
});

app.delete('/api/logs', (req, res) => {
  state.logs.length = 0;
  res.json({ logs: [] });
});

app.post('/api/test', async (req, res) => {
  const custom = req.body && Object.keys(req.body).length ? req.body : null;
  const payload = custom || {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15555555555', phone_number_id: 'PHONE_NUMBER_ID' },
          contacts: [{ profile: { name: 'Test User' }, wa_id: '15551234567' }],
          messages: [{ from: '15551234567', id: 'wamid.HBgNtest', timestamp: '1768000000', type: 'text', text: { body: 'Hello from the relay' } }]
        }
      }]
    }]
  };
  addLog('received', 'Received test payload', payload);
  const result = await forwardPayload(payload);
  res.json(result);
});

async function forwardPayload(payload) {
  const destination = state.config.destinationUrl;
  if (!destination) {
    addLog('warn', 'Forwarding skipped: no destination URL configured');
    return { forwarded: false, reason: 'no-destination' };
  }
  if (!state.forwarding) {
    addLog('warn', 'Forwarding skipped: forwarding is stopped');
    return { forwarded: false, reason: 'not-running' };
  }
  addLog('forwarding', `Forwarding to ${destination}`);
  try {
    const resp = await axios.post(destination, payload, {
      timeout: 15000,
      headers: { 'content-type': 'application/json', 'x-relay-source': 'meta-webhook-relay' }
    });
    addLog('success', `Forwarded successfully (${resp.status})`);
    return { forwarded: true, status: resp.status, data: resp.data };
  } catch (e) {
    const msg = e.response ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}` : e.message;
    addLog('error', `Forwarding failed: ${msg}`);
    return { forwarded: false, error: msg };
  }
}

async function handleWebhook(req, res) {
  const isValid = verifySignature(req);
  if (!isValid) {
    addLog('error', 'Rejected webhook: invalid X-Hub-Signature-256');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  addLog('received', `Webhook POST received from ${req.get('user-agent') || 'unknown'}`);
  const result = await forwardPayload(req.body);
  res.json({ received: true, ...result });
}

app.get('/webhook', (req, res) => {
  if (validChallenge(req)) {
    addLog('success', 'Webhook verified by Meta');
    return res.status(200).send(req.query['hub.challenge']);
  }
  if (!state.config.verifyToken) {
    addLog('error', 'Verification failed: verify token not configured');
  } else {
    addLog('error', 'Verification failed: token mismatch');
  }
  res.status(403).send('Verification failed');
});

app.post('/webhook', handleWebhook);

app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp Webhook Relay listening on http://localhost:${PORT}`);
  console.log(`Callback URL: http://localhost:${PORT}/webhook`);
  if (state.config.autoStart && state.config.destinationUrl) {
    state.forwarding = true;
    state.startedAt = new Date().toISOString();
    addLog('info', `Auto-started forwarding to ${state.config.destinationUrl}`);
    console.log('Auto-start: forwarding is ON');
  }
});