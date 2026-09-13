import { getConfig, saveConfig, safeConfig, isEnabled, getLogs, addLog, clearLogs } from './_shared/store.mjs';
import { WHATSAPP_TEST_PAYLOAD } from './_shared/meta.mjs';
import axios from 'axios';

const json = (body, statusCode = 200) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'content-type': 'application/json' }
});

function route(url) {
  return url.pathname
    .replace(/^\/\.netlify\/functions\/api\/?/, '/')
    .replace(/^\/api\/?/, '/')
    .replace(/^\/+/, '')
    .split('/')[0] || '';
}

export default async function handler(req) {
  const url = new URL(req.url);
  const path = route(url);
  const method = req.method;

  try {
    if (path === 'config' && method === 'GET') {
      return json(safeConfig(await getConfig()));
    }

    if (path === 'config' && method === 'POST') {
      let patch = {};
      try { patch = await req.json(); } catch (e) {}
      const cfg = await saveConfig({
        verifyToken: typeof patch.verifyToken === 'string' ? patch.verifyToken : undefined,
        appSecret: typeof patch.appSecret === 'string' ? patch.appSecret : undefined,
        destinationUrl: typeof patch.destinationUrl === 'string' ? patch.destinationUrl : undefined,
        autoStart: typeof patch.autoStart === 'boolean' ? patch.autoStart : undefined
      });
      await addLog('info', 'Configuration updated');
      return json({ config: safeConfig(cfg) });
    }

    if (path === 'health' && method === 'GET') {
      return json({ ok: true, forwarding: isEnabled(await getConfig()) });
    }

    if (path === 'start' && method === 'POST') {
      const cfg = await getConfig();
      if (!cfg.destinationUrl) {
        await addLog('error', 'Cannot start: no destination URL configured');
        return json({ error: 'Set a destination URL before starting forwarding' }, 400);
      }
      await saveConfig({ run: true });
      await addLog('info', `Forwarding started to ${cfg.destinationUrl}`);
      return json({ forwarding: true });
    }

    if (path === 'stop' && method === 'POST') {
      await saveConfig({ run: false });
      await addLog('info', 'Forwarding stopped');
      return json({ forwarding: false });
    }

    if (path === 'logs' && method === 'GET') {
      return json({ logs: await getLogs() });
    }

    if (path === 'logs' && method === 'DELETE') {
      await clearLogs();
      return json({ logs: [] });
    }

    if (path === 'test' && method === 'POST') {
      let custom = {};
      try { custom = await req.json(); } catch (e) {}
      const payload = custom && Object.keys(custom).length ? custom : WHATSAPP_TEST_PAYLOAD;
      await addLog('received', 'Received test payload', payload);

      const cfg = await getConfig();
      const dest = cfg.destinationUrl;
      const fwd = isEnabled(cfg);
      if (!dest || !fwd) {
        await addLog('warn', 'Forwarding skipped: ' + (!dest ? 'no destination URL' : 'forwarding is stopped'));
        return json({ forwarded: false, reason: fwd ? 'no-destination' : 'not-running' });
      }
      await addLog('forwarding', `Forwarding to ${dest}`);
      try {
        const resp = await axios.post(dest, payload, {
          timeout: 15000,
          headers: { 'content-type': 'application/json', 'x-relay-source': 'meta-webhook-relay' }
        });
        await addLog('success', `Forwarded successfully (${resp.status})`);
        return json({ forwarded: true, status: resp.status, data: resp.data });
      } catch (e) {
        const msg = e.response ? `HTTP ${e.response.status}` : e.message;
        await addLog('error', `Forwarding failed: ${msg}`);
        return json({ forwarded: false, error: msg });
      }
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}