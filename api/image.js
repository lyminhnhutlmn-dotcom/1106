export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, quality = 'high', referenceImages } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Thiếu prompt.' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chưa cấu hình OPENAI_API_KEY.' });

  try {
    let response;

    if (referenceImages && referenceImages.length > 0) {
      // Use edits endpoint with multipart/form-data
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const parts = [];

      // Helper to add text field
      const addField = (name, value) => {
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
        );
      };

      addField('model', 'gpt-image-2');
      addField('prompt', prompt.slice(0, 1000));
      addField('n', '1');
      addField('size', '1536x1024');
      addField('quality', quality);

      // Add reference images as binary parts
      const imageParts = [];
      for (let i = 0; i < Math.min(referenceImages.length, 3); i++) {
        const dataUrl = referenceImages[i];
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const ext = mime.split('/')[1] || 'png';
        const buffer = Buffer.from(base64, 'base64');

        imageParts.push({ buffer, mime, ext, index: i });
      }

      // Build multipart body as Buffer
      const textBody = parts.join('');
      const buffers = [Buffer.from(textBody, 'utf-8')];

      for (const { buffer, mime, ext, index } of imageParts) {
        const fieldName = referenceImages.length === 1 ? 'image' : `image[${index}]`;
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="ref_${index}.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`;
        buffers.push(Buffer.from(header, 'utf-8'));
        buffers.push(buffer);
        buffers.push(Buffer.from('\r\n', 'utf-8'));
      }

      buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));
      const body = Buffer.concat(buffers);

      response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length.toString()
        },
        body
      });

    } else {
      // Text to image — standard JSON
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
