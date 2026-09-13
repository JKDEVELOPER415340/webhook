import React, { useEffect, useState, useRef } from 'react';

const STORAGE_KEY = 'mwr-config';

function App() {
  const [config, setConfig] = useState({ verifyToken: '', appSecret: '', destinationUrl: '', autoStart: false });
  const [appSecretSet, setAppSecretSet] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const logsRef = useRef(null);

  const api = async (path, options = {}) => {
    const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const refresh = async () => {
    try {
      const [cfg, health, logData] = await Promise.all([
        api('/api/config'),
        api('/api/health'),
        api('/api/logs')
      ]);
      setConfig({ verifyToken: cfg.verifyToken, destinationUrl: cfg.destinationUrl, autoStart: cfg.autoStart, appSecret: '' });
      setAppSecretSet(cfg.appSecretSet);
      setForwarding(health.forwarding);
      setLogs(logData.logs);
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!forwarding) return;
    const t = setInterval(() => {
      api('/api/logs').then((d) => setLogs(d.logs)).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [forwarding]);

  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = 0; }, [logs]);

  const loadLocal = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setConfig((c) => ({ ...c, ...JSON.parse(raw) }));
    } catch (e) {}
  };
  useEffect(loadLocal, []);

  const save = async (e) => {
    e.preventDefault();
    setStatus('Saving...');
    try {
      const payload = { ...config, appSecret: config.appSecret || undefined };
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ verifyToken: config.verifyToken, destinationUrl: config.destinationUrl, autoStart: config.autoStart }));
      setAppSecretSet(data.config.appSecretSet);
      setSaved(true);
      setStatus('Saved');
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const start = async () => {
    setStatus('Starting forwarding...');
    try {
      await api('/api/start', { method: 'POST' });
      setForwarding(true);
      setStatus('Forwarding started');
      refresh();
    } catch (e) { setStatus(`Error: ${e.message}`); }
  };

  const stop = async () => {
    await api('/api/stop', { method: 'POST' });
    setForwarding(false);
    setStatus('Forwarding stopped');
  };

  const sendTest = async () => {
    setStatus('Sending WhatsApp test payload...');
    try {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
          changes: [{
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15555555555', phone_number_id: 'PHONE_NUMBER_ID' },
              contacts: [{ profile: { name: 'Test User' }, wa_id: '15551234567' }],
              messages: [{
                from: '15551234567', id: 'wamid.HBgN' + Date.now(),
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text', text: { body: 'Hello from the relay' }
              }]
            }
          }]
        }]
      };
      const res = await api('/api/test', { method: 'POST', body: JSON.stringify(payload) });
      setStatus(res.forwarded ? `Test forwarded (status ${res.status})` : `Test received but not forwarded`);
      refresh();
    } catch (e) { setStatus(`Error: ${e.message}`); }
  };

  const clearLogs = async () => {
    await api('/api/logs', { method: 'DELETE' });
    setLogs([]);
  };

  const copyWebhookUrl = () => {
    const base = window.location.origin;
    const url = `${base}/webhook`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const input = (key, label, extra) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <div className="field-row">
        {extra ? (
          <input id={key} className="mono" placeholder={extra.placeholder}
            value={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.value })} />
        ) : (
          <input id={key} className="mono"
            value={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.value })} />
        )}
      </div>
    </div>
  );

  return (
    <div className="app">
      <header>
        <h1>WhatsApp Webhook Relay</h1>
        <span className={`pill ${forwarding ? 'live' : 'idle'}`}>{forwarding ? 'Forwarding ON' : 'Forwarding OFF'}</span>
      </header>

      <section className="card">
        <h2>1. Configuration</h2>
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="verifyToken">Verify Token <em>(hub.verify_token)</em></label>
            <input id="verifyToken" className="mono" placeholder="your-verify-token" value={config.verifyToken}
              onChange={(e) => setConfig({ ...config, verifyToken: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="appSecret">Meta App Key (App Secret) <em>— verifies X-Hub-Signature-256 on every webhook</em></label>
            <input id="appSecret" className="mono" type="password"
              placeholder={appSecretSet ? '•••••••• (leave blank to keep current)' : 'your-app-secret'}
              value={config.appSecret} onChange={(e) => setConfig({ ...config, appSecret: e.target.value })} />
            <p className="hint">Find it in Meta Developer Portal → your app → App settings → Basic → App Secret (next to App ID). When set, webhooks with a wrong or missing signature get a 401.</p>
          </div>

          {input('destinationUrl', 'Destination URL <em>(where raw webhook data is forwarded)</em>', { placeholder: 'https://your-destination.api/endpoint' })}

          <label className="check">
            <input type="checkbox" checked={config.autoStart}
              onChange={(e) => setConfig({ ...config, autoStart: e.target.checked })} />
            Auto-start forwarding when server restarts
          </label>

          <div className="actions">
            <button type="submit" className="btn primary">{saved ? 'Saved ✓' : 'Save Config'}</button>
            <button type="button" className="btn" onClick={loadLocal}>Load Local Copy</button>
          </div>
        </form>
        {status && <p className="status">{status}</p>}
      </section>

      <section className="card">
        <h2>2. WhatsApp Setup</h2>
        <ol className="steps">
          <li>In the <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Meta Developer Portal</a>, create a <strong>Business</strong> app and add the <strong>WhatsApp</strong> product via your <a href="https://business.facebook.com/business/help/download" target="_blank" rel="noreferrer">Business Manager</a>.</li>
          <li>Link your WhatsApp Business Account (WABA) to the app and register a test phone number.</li>
          <li>Go to <strong>WhatsApp → Configuration → Webhook</strong>.</li>
          <li>Set <strong>Callback URL</strong> to your public HTTPS URL and <strong>Verify token</strong> to the token you configured above, then click <strong>Verify and Save</strong>.</li>
          <li>Under <strong>Webhook fields</strong>, subscribe to <strong>messages</strong> (and <strong>statuses</strong> if you want delivery reports).</li>
        </ol>
        <div className="field">
          <label>Your Callback URL</label>
          <div className="field-row">
            <input id="webhook-url" className="mono" readOnly value={`${window.location.origin}/webhook`} />
            <button type="button" className="btn" onClick={copyWebhookUrl}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>3. Forwarding</h2>
        <div className="actions">
          {!forwarding ? (
            <button type="button" className="btn primary" onClick={start}>Start Forwarding</button>
          ) : (
            <button type="button" className="btn danger" onClick={stop}>Stop Forwarding</button>
          )}
          <button type="button" className="btn" onClick={sendTest}>Send Test Payload</button>
        </div>
        <p className="hint">
          {config.destinationUrl
            ? `Raw data will be POSTed to ${config.destinationUrl}`
            : 'No destination URL set — configure one above.'}
        </p>
      </section>

      <section className="card">
        <div className="logs-header">
          <h2>Logs ({logs.length})</h2>
          <button type="button" className="btn small" onClick={clearLogs}>Clear</button>
        </div>
        <div className="logs" ref={logsRef}>
          {logs.length === 0 && <p className="hint">No activity yet.</p>}
          {logs.map((l) => (
            <div key={l.id} className={`log ${l.type}`}>
              <div>
                <span className="time">{new Date(l.time).toLocaleTimeString()}</span>
                <span className="badge">{l.type}</span>
                <span className="msg">{l.message}</span>
              </div>
              {l.body && <pre>{JSON.stringify(l.body, null, 2)}</pre>}
            </div>
          ))}
        </div>
      </section>

      <footer>
        Webhook endpoint: <code>/webhook</code> · Verification: <code>hub.mode</code>, <code>hub.verify_token</code>, <code>hub.challenge</code>
      </footer>
    </div>
  );
}

export default App;