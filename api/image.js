export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, quality = 'medium', referenceImages } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Thiếu prompt.' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chưa cấu hình OPENAI_API_KEY.' });

  try {
    let response;

    if (referenceImages && referenceImages.length > 0) {
      // Use edits endpoint — send FIRST image only as single file
      const dataUrl = referenceImages[0];
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');

      const boundary = 'FormBoundary' + Date.now();
      const CRLF = '\r\n';

      const part1 = Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
        `gpt-image-2${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="prompt"${CRLF}${CRLF}` +
        `${prompt.slice(0, 1000)}${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="n"${CRLF}${CRLF}` +
        `1${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="size"${CRLF}${CRLF}` +
        `1536x1024${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="image"; filename="reference.png"${CRLF}` +
        `Content-Type: image/png${CRLF}${CRLF}`,
        'utf-8'
      );
      const part2 = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf-8');
      const body = Buffer.concat([part1, buffer, part2]);

      response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body
      });

    } else {
      // Text to image
      response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt: prompt.slice(0, 1000),
          n: 1,
          size: '1536x1024',
          quality
        })
      });
    }

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { return res.status(500).json({ error: 'OpenAI error: ' + text.slice(0, 300) }); }

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || JSON.stringify(data) });
    }

    const imageData = data.data?.[0];
    if (!imageData) return res.status(500).json({ error: 'Không nhận được ảnh.' });

    res.status(200).json({
      url: imageData.url || null,
      b64: imageData.b64_json || null
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export const config = { maxDuration: 120 };
