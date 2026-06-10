export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { event, data } = req.body || {};
  console.log('ANNA_LOG:', JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
  res.json({ ok: true });
}
