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

  const q = ['auto','high','medium','low'].includes(quality) ? quality : 'medium';

  try {
    let response;

    if (referenceImages && referenceImages.length > 0) {
      // Use OpenAI Node SDK style — build proper multipart
      const { Readable } = await import('stream');
      
      const dataUrl = referenceImages[0];
      const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
      const imgBuffer = Buffer.from(base64, 'base64');
      
      // Use FormData with Blob (Node 18+ native)
      const formData = new FormData();
      formData.append('model', 'gpt-image-2');
      formData.append('prompt', prompt.slice(0, 1000));
      formData.append('n', '1');
      formData.append('size', '1024x1024');
      formData.append('quality', q);
      
      // Create Blob from buffer
      const blob = new Blob([imgBuffer], { type: 'image/png' });
      formData.append('image', blob, 'reference.png');

      response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        // Let fetch set Content-Type with boundary automatically
        body: formData
      });

    } else {
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
    catch(e) { return res.status(500).json({ error: 'Parse error: ' + text.slice(0, 300) }); }

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || JSON.stringify(data).slice(0, 300) 
      });
    }

    const imageData = data.data?.[0];
    if (!imageData) return res.status(500).json({ error: 'No image returned.' });

    res.status(200).json({
      url: imageData.url || null,
      b64: imageData.b64_json || null
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export const config = { maxDuration: 120 };
