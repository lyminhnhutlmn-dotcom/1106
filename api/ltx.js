// LTX 2.5 (Lightricks) — proxy cho LTX API v2 (async jobs)
// Docs: https://docs.ltx.io/async-jobs · https://docs.ltx.io/models/ltx-2-5
//
// POST /api/ltx  { action:'submit', mode:'t2v'|'i2v', prompt, model, duration, resolution, fps,
//                  generate_audio, camera_motion, image_uri, last_frame_uri }
//   → 202 { id, mode, created_at }
// POST /api/ltx  { action:'status', mode, id }   (hoặc GET /api/ltx?mode=i2v&id=...)
//   → { id, status:'pending'|'processing'|'completed'|'failed', result:{ video_url }, error }

const LTX_API_BASE = (process.env.LTX_API_BASE || 'https://api.ltx.io').replace(/\/+$/, '');

const MODELS = ['ltx-2-5-fast', 'ltx-2-5-pro', 'ltx-2-3-fast', 'ltx-2-3-pro'];
const RESOLUTIONS = {
  '1280x720': '720p', '720x1280': '720p',
  '1920x1080': '1080p', '1080x1920': '1080p',
  '2560x1440': '1440p', '1440x2560': '1440p',
  '3840x2160': '4K', '2160x3840': '4K'
};
const FPS = [24, 25, 48, 50];
const CAMERA_MOTION = ['dolly_in', 'dolly_out', 'dolly_left', 'dolly_right', 'jib_up', 'jib_down', 'static', 'focus_shift'];
const ENDPOINTS = { t2v: 'text-to-video', i2v: 'image-to-video' };

// Support matrix LTX-2.5 (giây). Các model 2.3 dùng chung bảng của pro để không chặn nhầm.
const LONG = [6, 8, 10, 12, 14, 16, 18, 20];
const SHORT = [6, 8, 10];
function allowedDurations(model, resolution, fps) {
  const tier = RESOLUTIONS[resolution];
  if (model === 'ltx-2-5-fast' && (tier === '720p' || tier === '1080p') && fps <= 25) return LONG;
  return SHORT;
}

// Data URI ảnh: LTX giới hạn 7 MB (đã encode); Vercel giới hạn body ~4.5 MB.
const MAX_DATA_URI_CHARS = 4 * 1024 * 1024;

function validateImageUri(uri, label) {
  if (typeof uri !== 'string' || !uri) return `${label} không hợp lệ.`;
  if (uri.startsWith('data:')) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(uri)) return `${label}: chỉ hỗ trợ PNG / JPEG / WEBP dạng base64.`;
    if (uri.length > MAX_DATA_URI_CHARS) return `${label} quá lớn (>4 MB sau khi encode). Hãy giảm kích thước ảnh.`;
    return null;
  }
  if (uri.startsWith('ltx://') || /^https:\/\/[^/]+\.[^/]+/.test(uri)) return null;
  return `${label}: cần HTTPS URL công khai, ltx:// URI hoặc data URI.`;
}

function json(res, status, body) {
  return res.status(status).json(body);
}

async function readUpstream(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch (e) { return { type: 'error', error: { type: 'parse_error', message: text.slice(0, 300) } }; }
}

function upstreamError(data, status) {
  return data?.error?.message || data?.message || `LTX API lỗi ${status}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.LTX_API_KEY;
  if (!apiKey) return json(res, 500, { error: 'Chưa cấu hình LTX_API_KEY trong Vercel.' });
  const headers = { 'Authorization': `Bearer ${apiKey}` };

  const body = req.method === 'GET' ? { action: 'status', ...(req.query || {}) } : (req.body || {});
  const action = body.action || 'submit';
  const mode = body.mode === 'i2v' ? 'i2v' : 't2v';
  const endpoint = ENDPOINTS[mode];

  try {
    // ---------- STATUS ----------
    if (action === 'status') {
      const id = String(body.id || '').trim();
      if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) return json(res, 400, { error: 'Thiếu hoặc sai job id.' });

      const upstream = await fetch(`${LTX_API_BASE}/v2/${endpoint}/${encodeURIComponent(id)}`, { headers });
      const data = await readUpstream(upstream);
      if (!upstream.ok) {
        const msg = upstream.status === 404 ? 'Job không tồn tại hoặc đã hết hạn (24h).' : upstreamError(data, upstream.status);
        return json(res, upstream.status, { error: msg });
      }
      return json(res, 200, {
        id: data.id || id,
        mode,
        status: data.status,
        created_at: data.created_at || null,
        completed_at: data.completed_at || null,
        result: data.result || null,
        error: data.error || null
      });
    }

    // ---------- SUBMIT ----------
    if (action !== 'submit') return json(res, 400, { error: 'action phải là submit hoặc status.' });

    const prompt = String(body.prompt || '').trim();
    if (!prompt) return json(res, 400, { error: 'Thiếu prompt.' });

    const model = MODELS.includes(body.model) ? body.model : 'ltx-2-5-fast';
    const resolution = RESOLUTIONS[body.resolution] ? body.resolution : '1280x720';
    const fps = FPS.includes(Number(body.fps)) ? Number(body.fps) : 24;

    // duration: null = để LTX-2.5 tự chọn theo prompt (chỉ ltx-2-5-*)
    let duration;
    if (body.duration === null || body.duration === 'auto' || body.duration === '') {
      if (!model.startsWith('ltx-2-5')) return json(res, 400, { error: 'Thời lượng tự động chỉ có trên LTX-2.5.' });
      duration = null;
    } else {
      duration = Number(body.duration);
      const allowed = allowedDurations(model, resolution, fps);
      if (!allowed.includes(duration)) {
        return json(res, 400, { error: `Thời lượng ${body.duration}s không hỗ trợ cho ${model} @ ${resolution} ${fps}fps. Cho phép: ${allowed.join(', ')}s.` });
      }
    }

    const payload = { prompt: prompt.slice(0, 6000), model, duration, resolution, fps };
    if (body.generate_audio === false) payload.generate_audio = false;
    if (body.camera_motion) {
      if (!CAMERA_MOTION.includes(body.camera_motion)) return json(res, 400, { error: 'camera_motion không hợp lệ.' });
      payload.camera_motion = body.camera_motion;
    }

    if (mode === 'i2v') {
      const err = validateImageUri(body.image_uri, 'Ảnh frame đầu');
      if (err) return json(res, 400, { error: err });
      payload.image_uri = body.image_uri;
      if (body.last_frame_uri) {
        const err2 = validateImageUri(body.last_frame_uri, 'Ảnh frame cuối');
        if (err2) return json(res, 400, { error: err2 });
        if (duration === null) return json(res, 400, { error: 'Không thể dùng thời lượng tự động cùng với ảnh frame cuối — hãy chọn thời lượng cố định.' });
        payload.last_frame_uri = body.last_frame_uri;
      }
    }

    const upstream = await fetch(`${LTX_API_BASE}/v2/${endpoint}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await readUpstream(upstream);
    if (!upstream.ok) {
      console.error('[ANNAHOUSESTUDIO][LTX] submit error', upstream.status, data?.error?.type, data?.error?.message);
      return json(res, upstream.status, { error: upstreamError(data, upstream.status), type: data?.error?.type || null });
    }

    return json(res, 202, {
      id: data.id,
      mode,
      created_at: data.created_at || null,
      request: { ...payload, image_uri: payload.image_uri ? '[image]' : undefined, last_frame_uri: payload.last_frame_uri ? '[image]' : undefined }
    });

  } catch (err) {
    console.error('[ANNAHOUSESTUDIO][LTX] Handler error:', err.message);
    return json(res, 500, { error: err.message });
  }
}

export const config = { maxDuration: 60 };
