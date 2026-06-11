import Anthropic from '@anthropic-ai/sdk';

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

    // If reference images provided → use edits endpoint (image-to-image)
    if (referenceImages && referenceImages.length > 0) {
      const { FormData, Blob } = await import('formdata-node');

      const form = new FormData();
      form.set('model', 'gpt-image-2');
      form.set('prompt', prompt.slice(0, 1000));
      form.set('n', '1');
      form.set('size', '1536x1024');
      form.set('quality', quality);

      // Add reference images
      for (let i = 0; i < Math.min(referenceImages.length, 3); i++) {
        const imgData = referenceImages[i];
        const base64 = imgData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const blob = new Blob([buffer], { type: 'image/png' });
        form.set(`image[${i}]`, blob, `ref_${i}.png`);
      }

      response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: form
      });

    } else {
      // Text to image — use generations endpoint
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
    catch(e) { return res.status(500).json({ error: 'OpenAI error: ' + text.slice(0, 200) }); }

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
