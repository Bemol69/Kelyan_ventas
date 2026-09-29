// Webpay Plus (Transbank) vía su API REST, sin SDK.
// Los archivos de /api que empiezan con _ no son funciones: esto lo usan crear.js, retorno.js y estado.js.
//
// Sin variables de entorno se usa el AMBIENTE DE INTEGRACIÓN (pruebas) con las credenciales públicas
// que Transbank publica en su documentación: no se cobra dinero real.
// Para pasar a producción (cuando Transbank entregue el código de comercio y la llave):
//   TBK_ENV=produccion  TBK_COMMERCE_CODE=...  TBK_API_KEY=...   (en Vercel → Settings → Environment Variables)
const { readdirSync, readFileSync } = require('node:fs');
const { join, basename } = require('node:path');

const PROD = process.env.TBK_ENV === 'produccion';
const HOST = PROD ? 'https://webpay3g.transbank.cl' : 'https://webpay3gint.transbank.cl';
const COMMERCE = PROD ? process.env.TBK_COMMERCE_CODE : '597055555532';
const API_KEY = PROD ? process.env.TBK_API_KEY : '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C';
const BASE = `${HOST}/rswebpaytransaction/api/webpay/v1.2/transactions`;

async function tbk(method, path = '', body) {
  if (!COMMERCE || !API_KEY) throw new Error('Faltan TBK_COMMERCE_CODE / TBK_API_KEY para producción');
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Tbk-Api-Key-Id': COMMERCE, 'Tbk-Api-Key-Secret': API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error_message || `Transbank respondió HTTP ${res.status}`), { status: res.status });
  return data;
}

// Precios desde data/productos (los mismos archivos que edita /admin), nunca desde el navegador
function catalogo() {
  const dir = join(process.cwd(), 'data', 'productos');
  const out = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (p.visible === false || typeof p.nombre !== 'string') continue;
      out.set(basename(f, '.json'), {
        nombre: p.nombre.trim(),
        precio: Math.max(0, Math.round(Number(p.precio) || 0)),
        tallas: (Array.isArray(p.tallas) ? p.tallas : []).map((t) => String(t).trim()).filter(Boolean),
        agotado: p.agotado === true,
      });
    } catch { /* archivo dañado: se ignora, igual que en el build */ }
  }
  return out;
}

// Funciona igual en Vercel (req.body ya viene leído) y en el servidor local (se lee el stream)
async function readBody(req) {
  if ('body' in req && req.body !== undefined) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    return parse(String(req.body), req.headers['content-type']);
  }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e5) break; }
  return parse(raw, req.headers['content-type']);
}
function parse(raw, type = '') {
  if (!raw) return {};
  if (type.includes('application/json')) { try { return JSON.parse(raw); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}

const query = (req) => Object.fromEntries(new URL(req.url, 'http://x').searchParams);
const origin = (req) => (process.env.SITE_URL
  || `${req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(req.headers.host) ? 'http' : 'https')}://${req.headers.host}`).replace(/\/$/, '');

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function redirect(res, url) {
  res.statusCode = 303;
  res.setHeader('Location', url);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

module.exports = { PROD, tbk, catalogo, readBody, query, origin, json, redirect };
