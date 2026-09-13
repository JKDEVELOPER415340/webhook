import { verifySignature, validChallenge } from './_shared/meta.mjs';
import { getConfig, addLog, isEnabled } from './_shared/store.mjs';
import axios from 'axios';

const json = (body, statusCode = 200) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'content-type': 'application/json' }
});

export default async function handler(req) {
  const url = new URL(req.url);
  const cfg = await getConfig();

  if (req.method === 'GET') {
    if (validChallenge(url.searchParams, cfg.verifyToken)) {
      await addLog('success', 'Webhook verified by Meta');
      return new Response(url.searchParams.get('hub.challenge'), {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      });
    }
    await addLog('error', 'Verification failed: ' + (!cfg.verifyToken ? 'verify token not configured' : 'token mismatch'));
    return new Response('Verification failed', { status: 403 });
  }

  if (req.method === 'POST') {
    const sig = req.headers.get('x-hub-signature-256') || '';
    const rawBody = await req.text();
    const valid = verifySignature(rawBody, sig, cfg.appSecret);
    if (!valid) {
      await addLog('error', 'Rejected webhook: invalid X-Hub-Signature-256');
      return json({ error: 'Invalid signature' }, 401);
    }

    let payload;
    try { payload = JSON.parse(rawBody); } catch (e) { payload = rawBody; }
    await addLog('received', `Webhook POST received from ${req.headers.get('user-agent') || 'unknown'}`, payload);

    const dest = cfg.destinationUrl;
    const fwd = isEnabled(cfg);
    if (!dest || !fwd) {
      await addLog('warn', 'Forwarding skipped: ' + (!dest ? 'no destination URL' : 'forwarding is stopped'));
      return json({ received: true, forwarded: false, reason: fwd ? 'no-destination' : 'not-running' });
    }

    await addLog('forwarding', `Forwarding to ${dest}`);
    try {
      const resp = await axios.post(dest, payload, {
        timeout: 15000,
        headers: { 'content-type': 'application/json', 'x-relay-source': 'meta-webhook-relay' }
      });
      await addLog('success', `Forwarded successfully (${resp.status})`);
      return json({ received: true, forwarded: true, status: resp.status, data: resp.data });
    } catch (e) {
      const msg = e.response ? `HTTP ${e.response.status}` : e.message;
      await addLog('error', `Forwarding failed: ${msg}`);
      return json({ received: true, forwarded: false, error: msg });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}