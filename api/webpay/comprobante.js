// POST /api/webpay/comprobante  { token, items: [{ id, size, qty }], cliente: { nombre, entrega } }  →  PDF
// Comprobante de pago con los datos que confirma Transbank (monto, tarjeta, autorización).
// El detalle de productos se vuelve a calcular con el catálogo y solo se muestra si suma el monto pagado.
// No es una boleta electrónica del SII: para eso hace falta un emisor autorizado (Bsale, OpenFactura, etc.).
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { PROD, tbk, catalogo, readBody, json } = require('../_webpay');

const TIPOS = { VD: 'Débito', VN: 'Crédito', VC: 'Crédito en cuotas', SI: '3 cuotas sin interés', S2: '2 cuotas sin interés', NC: 'Cuotas sin interés', VP: 'Prepago' };
const GOLD = rgb(0.71, 0.56, 0.16);
const INK = rgb(0.1, 0.09, 0.07);
const SOFT = rgb(0.42, 0.4, 0.36);
const LINE = rgb(0.87, 0.84, 0.77);

const clp = (n) => '$' + Number(n).toLocaleString('es-CL');
// Las fuentes estándar del PDF no traen emojis ni otros símbolos: se quitan
const txt = (s) => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, '').replace(/\s+/g, ' ').trim();
const readJson = (f) => { try { return JSON.parse(readFileSync(join(process.cwd(), f), 'utf8')); } catch { return {}; } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Usa POST' });
  try {
    const { token, items, cliente = {} } = await readBody(req);
    if (!token || !/^[\w-]{10,100}$/.test(token)) return json(res, 400, { error: 'Falta el token' });
    const t = await tbk('GET', `/${encodeURIComponent(token)}`);
    if (t.status !== 'AUTHORIZED' || t.response_code !== 0) return json(res, 409, { error: 'El pago no está aprobado' });

    // Detalle: precios del catálogo; si no cuadra con lo pagado (ej: cambió un precio), se muestra una sola línea
    const cat = catalogo();
    let lineas = (Array.isArray(items) ? items.slice(0, 50) : []).map((it) => {
      const p = cat.get(String(it.id));
      const qty = Math.floor(Number(it.qty));
      return p && qty >= 1 && qty <= 20 ? { nombre: p.nombre, talla: String(it.size || ''), qty, precio: p.precio } : null;
    });
    if (!lineas.length || lineas.includes(null) || lineas.reduce((s, l) => s + l.precio * l.qty, 0) !== t.amount) {
      lineas = [{ nombre: 'Compra en tienda online', talla: '', qty: 1, precio: t.amount }];
    }

    const cfg = readJson('tienda.config.json');
    const aj = readJson('data/ajustes.json');
    const tienda = txt(cfg.nombre || 'Tienda');
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Comprobante ${t.buy_order} · ${tienda}`);
    pdf.setAuthor(tienda);
    const page = pdf.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const M = 50;
    const draw = (s, x, y, o = {}) => {
      const font = o.bold ? bold : regular;
      const size = o.size || 10;
      let str = txt(s);
      if (o.max) while (str.length > 1 && font.widthOfTextAtSize(str, size) > o.max) str = str.slice(0, -2) + '…';
      const w = font.widthOfTextAtSize(str, size);
      page.drawText(str, { x: o.right ? x - w : o.center ? x - w / 2 : x, y, size, font, color: o.color || INK });
    };
    const wrap = (s, max, size) => txt(s).split(' ').reduce((out, w) => {
      const cand = out.length ? `${out[out.length - 1]} ${w}` : w;
      if (out.length && regular.widthOfTextAtSize(cand, size) <= max) out[out.length - 1] = cand;
      else out.push(w);
      return out;
    }, []);
    const hr = (y, color = LINE, th = 0.7) => page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: th, color });

    // Encabezado
    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: GOLD });
    let logoW = 0;
    try {
      const logo = await pdf.embedJpg(readFileSync(join(process.cwd(), 'img', 'logo.jpg')));
      const s = 56 / logo.height;
      logoW = logo.width * s + 14;
      page.drawImage(logo, { x: M, y: height - 94, width: logo.width * s, height: 56 });
    } catch { /* sin logo: solo el nombre */ }
    draw(tienda.toUpperCase(), M + logoW, height - 62, { bold: true, size: 18 });
    draw(txt(cfg.rubro), M + logoW, height - 80, { color: SOFT, size: 9.5 });
    draw('COMPROBANTE DE PAGO', width - M, height - 58, { bold: true, size: 12, right: true, color: GOLD });
    draw(`N° ${t.buy_order}`, width - M, height - 74, { size: 10, right: true });
    const fecha = t.transaction_date ? new Date(t.transaction_date).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' }) : '';
    draw(fecha, width - M, height - 88, { size: 9, right: true, color: SOFT });
    hr(height - 112, GOLD, 1.2);

    // Sello de estado + cliente
    let y = height - 146;
    page.drawRectangle({ x: M, y: y - 8, width: 92, height: 24, color: rgb(0.9, 0.97, 0.91), borderColor: rgb(0.2, 0.62, 0.32), borderWidth: 1 });
    draw('PAGADO', M + 46, y, { bold: true, size: 11, center: true, color: rgb(0.13, 0.5, 0.24) });
    if (!PROD) draw('Pago de prueba (Transbank integración): sin cobro real', M + 106, y, { size: 8.5, color: rgb(0.75, 0.35, 0.1) });
    y -= 38;
    const datos = [['Cliente', cliente.nombre], ['Entrega', cliente.entrega]].filter(([, v]) => txt(v));
    for (const [k, v] of datos) {
      draw(k, M, y, { color: SOFT, size: 9.5 });
      for (const linea of wrap(v, width - 2 * M - 70, 10).slice(0, 3)) {
        draw(linea, M + 70, y, { size: 10 });
        y -= 14;
      }
      y -= 2;
    }

    // Detalle
    y -= 14;
    page.drawRectangle({ x: M, y: y - 7, width: width - 2 * M, height: 22, color: rgb(0.97, 0.95, 0.89) });
    const cx = { prod: M + 10, talla: 340, cant: 400, unit: 475, total: width - M - 10 };
    draw('Producto', cx.prod, y, { bold: true, size: 9 });
    draw('Talla', cx.talla, y, { bold: true, size: 9, center: true });
    draw('Cant.', cx.cant, y, { bold: true, size: 9, center: true });
    draw('Precio', cx.unit, y, { bold: true, size: 9, right: true });
    draw('Total', cx.total, y, { bold: true, size: 9, right: true });
    y -= 26;
    for (const l of lineas) {
      draw(l.nombre, cx.prod, y, { size: 10, max: cx.talla - cx.prod - 30 });
      draw(l.talla || '—', cx.talla, y, { size: 10, center: true });
      draw(String(l.qty), cx.cant, y, { size: 10, center: true });
      draw(clp(l.precio), cx.unit, y, { size: 10, right: true });
      draw(clp(l.precio * l.qty), cx.total, y, { size: 10, right: true });
      y -= 10;
      hr(y);
      y -= 16;
    }
    y -= 4;
    draw('TOTAL PAGADO', cx.unit, y, { bold: true, size: 11, right: true });
    draw(clp(t.amount), cx.total, y, { bold: true, size: 14, right: true, color: GOLD });
    y -= 16;
    draw('Precios con IVA incluido', cx.total, y, { size: 8, right: true, color: SOFT });

    // Pago
    y -= 34;
    draw('DATOS DEL PAGO', M, y, { bold: true, size: 10, color: GOLD });
    y -= 8;
    hr(y);
    y -= 18;
    const tipo = TIPOS[t.payment_type_code] || t.payment_type_code || '';
    const pago = [
      ['Medio de pago', `Webpay Plus · ${tipo}${t.installments_number > 1 ? ` · ${t.installments_number} cuotas` : ''}`],
      ['Tarjeta', t.card_detail && t.card_detail.card_number ? `**** **** **** ${t.card_detail.card_number}` : ''],
      ['Código de autorización', t.authorization_code],
      ['Orden de compra', t.buy_order],
    ].filter(([, v]) => v);
    for (const [k, v] of pago) {
      draw(k, M, y, { color: SOFT, size: 9.5 });
      draw(v, M + 140, y, { size: 10 });
      y -= 16;
    }

    // Pie
    const contacto = [aj.whatsapp && `WhatsApp +${String(aj.whatsapp).replace(/\D/g, '')}`, aj.instagram && `Instagram @${String(aj.instagram).replace(/^@/, '')}`, cfg.site_url && cfg.site_url.replace(/^https?:\/\//, '')].filter(Boolean).join('   ·   ');
    hr(96);
    draw('¡Gracias por tu compra! Guarda este comprobante: lo necesitas para cambios y consultas.', width / 2, 78, { center: true, size: 9.5 });
    draw(contacto, width / 2, 62, { center: true, size: 9, color: SOFT });
    draw('Comprobante de pago electrónico. No reemplaza la boleta o factura electrónica emitida ante el SII.', width / 2, 40, { center: true, size: 7.5, color: SOFT });
    page.drawRectangle({ x: 0, y: 0, width, height: 6, color: GOLD });

    const bytes = await pdf.save();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="comprobante-${t.buy_order}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  } catch (e) {
    console.error('webpay/comprobante', e);
    json(res, 502, { error: 'No pudimos generar el comprobante.' });
  }
};
