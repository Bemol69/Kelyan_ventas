// POST /api/webpay/crear  { items: [{ id, size, qty }] }  →  { url, token, orden, monto }
// Calcula el total con los precios del catálogo y abre la transacción en Webpay Plus.
const { randomBytes } = require('node:crypto');
const { PROD, tbk, catalogo, readBody, origin, json } = require('../_webpay');

const MAX_QTY = 20;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Usa POST' });
  try {
    const { items } = await readBody(req);
    if (!Array.isArray(items) || !items.length || items.length > 50) return json(res, 400, { error: 'La bolsa está vacía' });

    const cat = catalogo();
    let monto = 0;
    for (const it of items) {
      const p = cat.get(String(it.id));
      const qty = Math.floor(Number(it.qty));
      const size = String(it.size || '');
      if (!p || p.agotado) return json(res, 409, { error: 'Un producto de tu bolsa ya no está disponible. Revisa tu bolsa.' });
      if (!p.precio) return json(res, 409, { error: `"${p.nombre}" no tiene precio publicado: pídelo por WhatsApp.` });
      if (!(qty >= 1 && qty <= MAX_QTY)) return json(res, 400, { error: 'Cantidad no válida' });
      if (p.tallas.length && !p.tallas.includes(size)) return json(res, 409, { error: `Elige una talla disponible de "${p.nombre}".` });
      monto += p.precio * qty;
    }

    // buy_order: máx. 26 caracteres · session_id: máx. 61
    const orden = `KV${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString('hex').toUpperCase()}`;
    const sesion = randomBytes(12).toString('hex');
    const t = await tbk('POST', '', {
      buy_order: orden,
      session_id: sesion,
      amount: monto,
      return_url: `${origin(req)}/api/webpay/retorno`,
    });
    json(res, 200, { url: t.url, token: t.token, orden, monto, pruebas: !PROD });
  } catch (e) {
    console.error('webpay/crear', e);
    json(res, 502, { error: 'No pudimos conectar con Webpay. Intenta de nuevo en unos minutos.' });
  }
};
