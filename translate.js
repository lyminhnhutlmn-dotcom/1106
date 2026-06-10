import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { prompt, targetLang = 'en' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Thiếu prompt.' });

  const sys = targetLang === 'en'
    ? `Expert cinematic prompt translator. Translate Vietnamese to professional English for AI video generation. Keep all technical terms, section headers, timestamps. Output ONLY translated prompt.`
    : `Translate English cinematic prompt to Vietnamese. Keep technical terms. Output only translated prompt.`;

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6', max_tokens: 16000,
      system: sys, messages: [{ role: 'user', content: prompt }]
    });
    for await (const e of stream) {
      if (e.type === 'content_block_delta' && e.delta?.text)
        res.write(`data: ${JSON.stringify({ text: e.delta.text })}\n\n`);
    }
    res.write('data: [DONE]\n\n'); res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
}
export const config = { maxDuration: 120 };
