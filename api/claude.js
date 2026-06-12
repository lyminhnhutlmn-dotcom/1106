export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { system, message, max_tokens = 16000, images } = req.body;
  if (!message) return res.status(400).json({ error: 'Thiếu message.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chưa cấu hình ANTHROPIC_API_KEY trong Vercel.' });

  // Build content: images first (if any), then text
  let content;
  if (images && Array.isArray(images) && images.length > 0) {
    content = [];
    for (const img of images.slice(0, 4)) {
      const m = String(img).match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
      if (m) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: m[1], data: m[2] }
        });
      }
    }
    content.push({ type: 'text', text: message });
  } else {
    content = message;
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-fable-5',
        max_tokens,
        system: system || '',
        stream: true,
        messages: [{ role: 'user', content }]
      })
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      let errMsg;
      try { errMsg = JSON.parse(errText).error?.message; } catch (e) {}
      return res.status(upstream.status).json({ error: errMsg || errText.slice(0, 300) });
    }

    // Stream SSE to client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j.type === 'content_block_delta' && j.delta?.text) {
            res.write(`data: ${JSON.stringify({ text: j.delta.text })}\n\n`);
          }
        } catch (e) {}
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
}

export const config = { maxDuration: 300 };
