import { verifySignature, validChallenge } from './_shared/meta.mjs';
import { getConfig, addLog, isEnabled } from './_shared/store.mjs';
import axios from 'axios';

export default async function handler(event) {
  const cfg = await getConfig();
  const authHeader = (key) => event.headers[key] || event.headers[key.toLowerCase()] || '';

  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    if (validChallenge(qs, cfg.verifyToken)) {
      await addLog('success', 'Webhook verified by Meta');
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        body: qs['hub.challenge']
      };
    }
    await addLog('error', 'Verification failed: ' + (!cfg.verifyToken ? 'verify token not configured' : 'token mismatch'));
    return { statusCode: 403, body: 'Verification failed' };
  }

  if (event.httpMethod === 'POST') {
    const sig = authHeader('x-hub-signature-256');
    const valid = verifySignature(event.body, sig, cfg.appSecret);
    if (!valid) {
      await addLog('error', 'Rejected webhook: invalid X-Hub-Signature-256');
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }), headers: { 'content-type': 'application/json' } };
    }

    let payload;
    try { payload = JSON.parse(event.body); } catch (e) { payload = event.body; }
    await addLog('received', `Webhook POST received from ${authHeader('user-agent') || 'unknown'}`, payload);

    const dest = cfg.destinationUrl;
    const fwd = isEnabled(cfg);
    if (!dest || !fwd) {
      await addLog('warn', 'Forwarding skipped: ' + (!dest ? 'no destination URL' : 'forwarding is stopped'));
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ received: true, forwarded: false, reason: fwd ? 'no-destination' : 'not-running' }) };
    }

    await addLog('forwarding', `Forwarding to ${dest}`);
    try {
      const resp = await axios.post(dest, payload, {
        timeout: 15000,
        headers: { 'content-type': 'application/json', 'x-relay-source': 'meta-webhook-relay' }
      });
      await addLog('success', `Forwarded successfully (${resp.status})`);
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ received: true, forwarded: true, status: resp.status, data: resp.data }) };
    } catch (e) {
      const msg = e.response ? `HTTP ${e.response.status}` : e.message;
      await addLog('error', `Forwarding failed: ${msg}`);
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ received: true, forwarded: false, error: msg }) };
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
}

export { handler };