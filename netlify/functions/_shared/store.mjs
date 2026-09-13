import { getStore } from '@netlify/blobs';
import crypto from 'crypto';

let cache = null;
function store() {
  if (!cache) cache = getStore('relay');
  return cache;
}

const MAX_LOGS = 200;

const ENV_DEFAULTS = {
  verifyToken: process.env.VERIFY_TOKEN || '',
  appSecret: process.env.APP_SECRET || '',
  destinationUrl: process.env.DESTINATION_URL || '',
  autoStart: process.env.AUTO_START === 'true'
};

export async function getConfig() {
  const cfg = { ...ENV_DEFAULTS };
  try {
    const saved = await store().getJSON('config');
    if (saved && typeof saved === 'object') {
      if (typeof saved.verifyToken === 'string') cfg.verifyToken = saved.verifyToken;
      if (typeof saved.appSecret === 'string') cfg.appSecret = saved.appSecret;
      if (typeof saved.destinationUrl === 'string') cfg.destinationUrl = saved.destinationUrl;
      if (typeof saved.autoStart === 'boolean') cfg.autoStart = saved.autoStart;
      if (typeof saved.run === 'boolean') cfg.run = saved.run;
    }
  } catch (e) {}
  return cfg;
}

export async function saveConfig(patch) {
  const cfg = await getConfig();
  for (const key of ['verifyToken', 'appSecret', 'destinationUrl', 'autoStart', 'run']) {
    if (patch[key] !== undefined) cfg[key] = patch[key];
  }
  try {
    await store().setJSON('config', cfg);
  } catch (e) {}
  return cfg;
}

export function isEnabled(cfg) {
  return cfg.run !== undefined ? cfg.run : Boolean(cfg.destinationUrl && cfg.autoStart);
}

export function safeConfig(cfg) {
  const { appSecret, ...rest } = cfg;
  return { ...rest, appSecretSet: Boolean(cfg.appSecret) };
}

export async function getLogs() {
  try {
    const logs = await store().getJSON('logs');
    return Array.isArray(logs) ? logs : [];
  } catch (e) {
    return [];
  }
}

export async function addLog(type, message, body) {
  const logs = await getLogs();
  logs.unshift({ id: crypto.randomUUID(), type, message, body: body || null, time: new Date().toISOString() });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  try {
    await store().setJSON('logs', logs);
  } catch (e) {}
}

export async function clearLogs() {
  try {
    await store().delete('logs');
  } catch (e) {}
}