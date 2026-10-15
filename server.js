import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '50mb' }));

const ROUTES = ['claude', 'image', 'log', 'translate'];

// Mount the existing Vercel-style handlers (lazy import so a missing API key in one module does not crash startup)
app.all('/api/:name', async (req, res) => {
  const name = req.params.name;
  if (!ROUTES.includes(name)) return res.status(404).json({ error: 'Not found' });
  try {
    const mod = await import(`./api/${name}.js`);
    return await mod.default(req, res);
  } catch (err) {
    console.error('Handler error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Listening on 0.0.0.0:${port}`));
