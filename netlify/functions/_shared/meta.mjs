import crypto from 'crypto';

export function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true;
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    const received = Buffer.from(signatureHeader.split('=')[1], 'hex');
    const computed = Buffer.from(expected.split('=')[1], 'hex');
    return received.length === computed.length && crypto.timingSafeEqual(received, computed);
  } catch (e) {
    return false;
  }
}

export function validChallenge(searchParams, verifyToken) {
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  return mode === 'subscribe' && token === verifyToken && typeof challenge === 'string' && challenge.length > 0;
}

export const WHATSAPP_TEST_PAYLOAD = {
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