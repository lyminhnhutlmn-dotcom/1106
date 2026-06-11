export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, quality, referenceImages } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Thiếu prompt.' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chưa cấu hình OPENAI_API_KEY.' });

  // Validate quality — only these values accepted
  const validQualities = ['auto', 'high', 'medium', 'low'];
  const q = validQualities.includes(quality) ? quality : 'medium';

  try {
    let response;

    if (referenceImages && referenceImages.length > 0) {
      // Edits endpoint with reference image
      const dataUrl = referenceImages[0];
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64, 'base64');
      const boundary = 'Boundary' + Date.now().toString(36);
      const NL = '\r\n';

      const textParts =
        `--${boundary}${NL}Content-Disposition: form-data; name="model"${NL}${NL}gpt-image-2${NL}` +
        `--${boundary}${NL}Content-Disposition: form-data; name="prompt"${NL}${NL}${prompt.slice(0,1000)}${NL}` +
        `--${boundary}${NL}Content-Disposition: form-data; name="n"${NL}${NL}1${NL}` +
        `--${boundary}${NL}Content-Disposition: form-data; name="size"${NL}${NL}1024x1024${NL}` +
        `--${boundary}${NL}Content-Disposition: form-data; name="quality"${NL}${NL}${q}${NL}` +
        `--${boundary}${NL}Content-Disposition: form-data; name="image"; filename="ref.png"${NL}Content-Type: image/png${NL}${NL}`;

      const body = Buffer.concat([
        Buffer.from(textParts, 'utf-8'),
        imgBuffer,
        Buffer.from(`${NL}--${boundary}--${NL}`, 'utf-8')
      ]);

      response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body
      });

    } else {
      // Text to image — generations endpoint
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
          quality: q
        })
      });
    }

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { return res.status(500).json({ error: 'Parse error: ' + text.slice(0, 200) }); }

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || JSON.stringify(data).slice(0,200) });
    }

    const imageData = data.data?.[0];
    if (!imageData) return res.status(500).json({ error: 'No image in response.' });

    res.status(200).json({
      url: imageData.url || null,
      b64: imageData.b64_json || null
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export const config = { maxDuration: 120 };
