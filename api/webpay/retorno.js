// Webpay devuelve al cliente aquí (GET o POST, según el caso). Se confirma el pago y se
// redirige a /pago.html, que consulta el resultado real en /api/webpay/estado.
//  · token_ws               → flujo normal: se confirma (commit)
//  · TBK_TOKEN              → el cliente anuló el pago en el formulario de Webpay
//  · solo TBK_ORDEN_COMPRA  → se acabó el tiempo (más de 5 min en el formulario)
//  · token_ws + TBK_TOKEN   → error en el formulario
const { tbk, readBody, query, redirect } = require('../_webpay');

module.exports = async (req, res) => {
  const p = { ...query(req), ...(req.method === 'POST' ? await readBody(req) : {}) };
  const orden = encodeURIComponent(p.TBK_ORDEN_COMPRA || '');

  if (p.token_ws && !p.TBK_TOKEN) {
    try {
      await tbk('PUT', `/${encodeURIComponent(p.token_ws)}`);
    } catch (e) {
      // Si falla (ej: se recargó y ya estaba confirmada), estado.js igual muestra el resultado real
      console.error('webpay/retorno commit', e.message);
    }
    return redirect(res, `/pago.html?token=${encodeURIComponent(p.token_ws)}`);
  }
  if (p.TBK_TOKEN && !p.token_ws) return redirect(res, `/pago.html?estado=anulado&orden=${orden}`);
  if (p.TBK_ORDEN_COMPRA && !p.TBK_TOKEN) return redirect(res, `/pago.html?estado=expirado&orden=${orden}`);
  return redirect(res, `/pago.html?estado=error&orden=${orden}`);
};
