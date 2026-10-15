/** Encrypted share documents stored at an unlisted MantleDB path. */

const HOST = "https://mantledb.sh/v2";
const MAX_BODY = 60000;

export function bytesToB64u(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64uToBytes(value) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function hexId(bytes = 8) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function importKey(ek) {
  const raw = b64uToBytes(ek);
  if (raw.length !== 32) throw new Error("badkey");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function generateEk() {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return bytesToB64u(raw);
}

export function validNs(ns) {
  return /^tvc[a-f0-9]{16}$/.test(ns || "");
}

export function validWk(wk) {
  return wk === "" || /^[a-f0-9]{32,128}$/.test(wk || "");
}

export function stripSecrets(project) {
  const copy = JSON.parse(JSON.stringify(project));
  delete copy.cloud;
  return copy;
}

export async function packProject(project, ek) {
  const json = new TextEncoder().encode(JSON.stringify(stripSecrets(project)));
  const gz = await gzipBytes(json);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(ek);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, gz));
  const packed = { v: 1, iv: bytesToB64u(iv), ct: bytesToB64u(ct) };
  if (JSON.stringify(packed).length > MAX_BODY) {
    const error = new Error("too-big");
    error.code = "too-big";
    throw error;
  }
  return packed;
}

export async function unpackProject(packed, ek) {
  if (!packed || packed.v !== 1 || !packed.iv || !packed.ct) throw new Error("badpack");
  const key = await importKey(ek);
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64uToBytes(packed.iv) },
      key,
      b64uToBytes(packed.ct),
    );
  } catch {
    throw new Error("badkey");
  }
  const json = new TextDecoder().decode(await gunzipBytes(new Uint8Array(plain)));
  return JSON.parse(json);
}

export async function encodeSnapshot(project) {
  const json = new TextEncoder().encode(JSON.stringify(stripSecrets(project)));
  const gz = await gzipBytes(json);
  const encoded = bytesToB64u(gz);
  if (encoded.length > 80000) {
    const error = new Error("too-big");
    error.code = "too-big";
    throw error;
  }
  return encoded;
}

export async function decodeSnapshot(encoded) {
  if (!encoded || encoded.length > 80000) throw new Error("badpack");
  const json = new TextDecoder().decode(await gunzipBytes(b64uToBytes(encoded)));
  return JSON.parse(json);
}

async function errorMessage(res) {
  try {
    const body = await res.json();
    return body.message || body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function createRemote(packed) {
  const ns = `tvc${hexId(8)}`;
  const write = await fetch(`${HOST}/${ns}/doc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(packed),
    signal: AbortSignal.timeout(20000),
  });
  if (!write.ok) throw new Error(await errorMessage(write));
  let wk = "";
  try {
    const claim = await fetch(`${HOST}/claim/${ns}`, { signal: AbortSignal.timeout(20000) });
    const body = await claim.json();
    if (claim.ok && body.key) wk = body.key;
  } catch {
    wk = "";
  }
  return { ns, wk };
}

export async function writeRemote(ns, wk, packed) {
  if (!validNs(ns) || !validWk(wk)) throw new Error("bad-id");
  const headers = { "Content-Type": "application/json" };
  if (wk) headers["X-Mantle-Key"] = wk;
  const res = await fetch(`${HOST}/${ns}/doc`, {
    method: "POST",
    headers,
    body: JSON.stringify(packed),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function readRemote(ns, wk) {
  if (!validNs(ns) || !validWk(wk)) throw new Error("bad-id");
  const headers = {};
  if (wk) headers["X-Mantle-Key"] = wk;
  const res = await fetch(`${HOST}/${ns}/doc`, { headers, signal: AbortSignal.timeout(20000) });
  if (res.status === 404) {
    const error = new Error("notfound");
    error.code = "notfound";
    throw error;
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function deleteRemote(ns, wk) {
  if (!validNs(ns) || !validWk(wk)) return;
  const headers = {};
  if (wk) headers["X-Mantle-Key"] = wk;
  await fetch(`${HOST}/${ns}/doc`, { method: "DELETE", headers, signal: AbortSignal.timeout(20000) });
}

export function cloudHash(cloud) {
  const params = new URLSearchParams();
  params.set("ns", cloud.ns);
  if (cloud.wk) params.set("wk", cloud.wk);
  params.set("ek", cloud.ek);
  return params.toString();
}

export async function publishProject(project) {
  const syncedAt = project.updatedAt;
  const ek = project.cloud?.ek || await generateEk();
  const packed = await packProject({ ...project, updatedAt: syncedAt }, ek);
  if (!project.cloud?.ns) {
    const created = await createRemote(packed);
    return { ns: created.ns, wk: created.wk, ek, syncedAt };
  }
  await writeRemote(project.cloud.ns, project.cloud.wk || "", packed);
  return { ns: project.cloud.ns, wk: project.cloud.wk || "", ek, syncedAt };
}

export async function openCloud(ns, wk, ek) {
  const packed = await readRemote(ns, wk || "");
  return unpackProject(packed, ek);
}
