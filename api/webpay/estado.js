// GET /api/webpay/estado?token=...  →  resultado del pago, preguntado directo a Transbank
// (así nadie puede "fabricar" un pago aprobado cambiando la URL de /pago.html)
const { PROD, tbk, query, json } = require('../_webpay');

const TIPOS = { VD: 'Débito', VN: 'Crédito', VC: 'Crédito en cuotas', SI: '3 cuotas sin interés', S2: '2 cuotas sin interés', NC: 'Cuotas sin interés', VP: 'Prepago' };

module.exports = async (req, res) => {
  const { token } = query(req);
  if (!token || !/^[\w-]{10,100}$/.test(token)) return json(res, 400, { error: 'Falta el token' });
  try {
    const t = await tbk('GET', `/${encodeURIComponent(token)}`);
    json(res, 200, {
      aprobado: t.status === 'AUTHORIZED' && t.response_code === 0,
      estado: t.status,
      orden: t.buy_order,
      monto: t.amount,
      tarjeta: t.card_detail && t.card_detail.card_number ? `**** ${t.card_detail.card_number}` : '',
      autorizacion: t.authorization_code || '',
      tipo: TIPOS[t.payment_type_code] || t.payment_type_code || '',
      cuotas: t.installments_number || 0,
      fecha: t.transaction_date || '',
      pruebas: !PROD,
    });
  } catch (e) {
    console.error('webpay/estado', e.message);
    json(res, 502, { error: 'No pudimos consultar el pago en Webpay.' });
  }
};
