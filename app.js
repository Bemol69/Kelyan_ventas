// ===== CONFIGURACIÓN =====
// Datos de la tienda: los inserta scripts/build.mjs desde tienda.config.json y data/ajustes.json
const TIENDA = %%TIENDA_JSON%%;
const WHATSAPP_NUMBER = TIENDA.whatsapp;

const ENTREGAS = {
  punto: `Entrega en ${TIENDA.punto}`,
  delivery: 'Delivery en Santiago',
  envio: 'Envío',
};
const PAGOS = {
  transferencia: '🏦 *Pago:* Transferencia',
  efectivo: '💵 *Pago:* Efectivo al recibir',
  webpay: '💳 *Pago:* Webpay (débito o crédito)',
};

// Buscadores oficiales de sucursales (ninguna de las 3 empresas tiene una API pública sin contrato)
const COURIERS = {
  Starken: 'https://www.starken.cl/sucursales',
  Chilexpress: 'https://centrodeayuda.chilexpress.cl/sucursales',
  'Blue Express': 'https://www.blue.cl/lockers-puntos/encuentra-tu-punto',
};
const EMPRESAS = (TIENDA.empresas_envio || []).filter((e) => COURIERS[e]);

// Productos y categorías se editan desde el panel /admin (data/productos, data/categorias)
// y se publican juntos en data/catalogo.json (lo genera scripts/build.mjs)
let PRODUCTS = [];
let FILTERS = [['todos', 'Todos']];
let REGIONES = [];

const SORTS = {
  destacados: null,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
};
const MAX_QTY = 20;
const PER_PAGE = 12; // productos por página del catálogo

// ===== UTILIDADES =====
const clp = (n) => '$' + n.toLocaleString('es-CL');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
const priceText = (p) => (p.price > 0 ? clp(p.price) : 'Consultar precio');
// Se usa api.whatsapp.com y no wa.me: la redirección de wa.me rompe los emojis (llegan como �)
const waUrl = (text) =>
  `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}${text ? '&text=' + encodeURIComponent(text) : ''}`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('is-on'), 2400);
}

// Fotos con otra proporción que el marco 3:4 (reels 9:16, fotos cuadradas) se muestran completas,
// sin recortar, sobre un fondo difuminado de la misma imagen
function fitImage(img) {
  const box = img.closest('.card__img, .pm__frame');
  if (!box || !img.naturalWidth || img.classList.contains('alt')) return;
  const r = img.naturalHeight / img.naturalWidth;
  const fit = r > 1.5 || r < 1.15;
  box.classList.toggle('is-fit', fit);
  if (fit) box.style.setProperty('--fit-bg', `url("${img.currentSrc || img.src}")`);
}
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') fitImage(e.target); }, true);
const fitAll = (root) => root.querySelectorAll('.card__img img, .pm__frame img').forEach((img) => { if (img.complete) fitImage(img); });
fitAll(document);

function lockScroll() {
  const open = ['#productModal', '#bag'].some((s) => { const el = $(s); return el && el.classList.contains('is-open'); });
  document.body.style.overflow = open ? 'hidden' : '';
}

// ===== CATÁLOGO =====
const grid = $('#productGrid');
const filters = $('#filters');
let currentCat = 'todos';
let currentPage = 1;

function renderFilters(active) {
  const count = (k) => (k === 'todos' ? PRODUCTS.length : PRODUCTS.filter((p) => p.tags.includes(k)).length);
  filters.innerHTML = FILTERS
    .filter(([k]) => count(k) > 0) // oculta categorías vacías
    .map(([k, label]) => `<button class="tab ${k === active ? 'is-active' : ''}" role="tab" aria-selected="${k === active}" data-cat="${esc(k)}">${esc(label)}<span class="tab__n">${count(k)}</span></button>`)
    .join('');
}

// Misma tarjeta que escribe scripts/build.mjs en el HTML (para Google)
const card = (p) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <button class="card__img" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}
        ${p.gallery.length > 1 ? `<span class="card__more">+${p.gallery.length - 1} ${p.gallery.length === 2 ? 'foto' : 'fotos'}</span>` : ''}
        <img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" decoding="async">
        ${p.thumbs[1] ? `<img class="alt" src="${esc(p.thumbs[1])}" alt="" loading="lazy" decoding="async">` : ''}
      </button>
      <div class="card__body">
        <h3>${esc(p.name)}</h3>
        ${p.desc ? `<p class="card__desc">${esc(p.desc)}</p>` : ''}
        ${p.sizes.length ? `<ul class="sizes" aria-label="Tallas disponibles">${p.sizes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <div class="card__foot">
          <span class="price${p.price > 0 ? '' : ' price--ask'}">${priceText(p)}</span>
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(waUrl(`Hola! ¿Tienen stock de ${p.name}?`))}">Consultar stock</a>`
            : `<button class="btn btn--primary btn--sm" type="button" data-view="${esc(p.id)}">${p.sizes.length > 1 ? 'Elegir talla' : 'Agregar'}</button>`}
        </div>
      </div>
    </article>`;

function renderProducts(cat = currentCat, page = 1) {
  currentCat = cat;
  let list = cat === 'todos' ? PRODUCTS : PRODUCTS.filter((p) => p.tags.includes(cat));
  const sort = SORTS[$('#sort').value];
  if (sort) list = [...list].sort(sort);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  currentPage = Math.min(Math.max(1, page), pages);
  const from = (currentPage - 1) * PER_PAGE;
  const shown = list.slice(from, from + PER_PAGE);
  $('#count').innerHTML = pages > 1
    ? `Mostrando <strong>${from + 1}–${from + shown.length}</strong> de <strong>${list.length}</strong> modelos`
    : `Mostrando <strong>${list.length}</strong> ${list.length === 1 ? 'modelo' : 'modelos'}`;
  grid.innerHTML = shown.map(card).join('');
  fitAll(grid);
  renderPager(pages);
}

// Números de página: 1 … 4 5 6 … 10 (siempre la primera, la última y las vecinas de la actual)
function renderPager(pages) {
  const pager = $('#pager');
  pager.hidden = pages < 2;
  if (pages < 2) { pager.innerHTML = ''; return; }
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - currentPage) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const arrow = (to, label, dir) =>
    `<button type="button" class="pager__btn pager__arrow" data-page="${to}" aria-label="${label}"${to < 1 || to > pages ? ' disabled' : ''}>${dir}</button>`;
  pager.innerHTML =
    arrow(currentPage - 1, 'Página anterior', '‹') +
    nums.map((n) => n === '…'
      ? '<span class="pager__gap" aria-hidden="true">…</span>'
      : `<button type="button" class="pager__btn${n === currentPage ? ' is-active' : ''}" data-page="${n}"${n === currentPage ? ' aria-current="page"' : ''} aria-label="Página ${n}">${n}</button>`).join('') +
    arrow(currentPage + 1, 'Página siguiente', '›');
}

$('#pager').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-page]');
  if (!btn || btn.disabled) return;
  renderProducts(currentCat, +btn.dataset.page);
  $('#filters').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  renderFilters(btn.dataset.cat);
  renderProducts(btn.dataset.cat);
});
$('#sort').addEventListener('change', () => renderProducts());

// ===== FICHA DE PRODUCTO =====
const pModal = $('#productModal');
let current = null;
let photo = 0;
let pick = { size: '', qty: 1 };
let lastFocus = null;

function showPhoto(i) {
  const g = current.gallery;
  photo = (i + g.length) % g.length;
  const img = $('#pmImg');
  const frame = img.parentElement;
  const src = g[photo];
  // La foto se oculta hasta que la nueva está cargada y medida: si no, por un instante se ve la del producto anterior
  if (img.getAttribute('src') !== src) {
    frame.classList.add('is-loading');
    frame.classList.remove('is-fit');
    img.src = src;
    const listo = () => {
      if (img.getAttribute('src') !== src) return; // ya se pidió otra foto
      fitImage(img);
      frame.classList.remove('is-loading');
    };
    if (img.complete && img.naturalWidth) listo();
    else {
      img.addEventListener('load', listo, { once: true });
      img.addEventListener('error', listo, { once: true });
      setTimeout(listo, 1200); // seguro: nunca dejar la foto oculta si algo falla
    }
  }
  $('#pmThumbs').querySelectorAll('button').forEach((b, k) => b.classList.toggle('is-active', k === photo));
}

function renderSizes() {
  $('#pmSizes').innerHTML = current.sizes
    .map((t) => `<button type="button" role="radio" aria-checked="${t === pick.size}" data-size="${esc(t)}">${esc(t)}</button>`)
    .join('');
}

function openProduct(id) {
  const p = findProduct(id);
  if (!p) return;
  lastFocus = document.activeElement;
  current = p;
  pick = { size: p.sizes.length === 1 ? p.sizes[0] : '', qty: 1 };

  $('#pmImg').alt = p.name;
  $('#pmThumbs').innerHTML = p.gallery.length > 1
    ? p.thumbs.map((src, i) => `<button type="button" data-photo="${i}" aria-label="Foto ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')
    : '';
  pModal.classList.toggle('has-gallery', p.gallery.length > 1);
  showPhoto(0);
  p.gallery.slice(1).forEach((src) => { new Image().src = src; }); // precarga el resto de la galería
  $('#pmCat').textContent = FILTERS.filter(([k]) => p.tags.includes(k)).map(([, l]) => l).join(' · ');
  $('#pmName').textContent = p.name;
  $('#pmPrice').textContent = priceText(p);
  $('#pmDesc').textContent = p.desc;
  $('#pmSizesWrap').hidden = !p.sizes.length;
  $('#pmSizeHint').textContent = p.sizes.length === 1 ? '· única disponible' : '';
  renderSizes();
  $('#pmQty').textContent = '1';
  $('#pmError').hidden = true;
  $('#pmAdd').hidden = p.agotado;
  document.querySelector('.pm__qty').hidden = p.agotado;
  $('#pmAsk').href = waUrl(`Hola! Quiero consultar por ${p.name} 👑`);

  pModal.classList.add('is-open');
  pModal.setAttribute('aria-hidden', 'false');
  lockScroll();
  $('#pmAdd').hidden ? $('#pmAsk').focus() : pModal.querySelector('.modal__close').focus();
}

function closeProduct() {
  if (!pModal.classList.contains('is-open')) return;
  pModal.classList.remove('is-open');
  pModal.setAttribute('aria-hidden', 'true');
  lockScroll();
  if (lastFocus && !bagEl.classList.contains('is-open')) lastFocus.focus();
}

pModal.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close]')) { closeProduct(); return; }
  const thumb = t.closest('[data-photo]');
  if (thumb) showPhoto(Number(thumb.dataset.photo));
  const step = t.closest('[data-step-photo]');
  if (step) showPhoto(photo + Number(step.dataset.stepPhoto));
  const size = t.closest('[data-size]');
  if (size) {
    pick.size = size.dataset.size;
    $('#pmError').hidden = true;
    renderSizes();
  }
  const q = t.closest('[data-qty]');
  if (q) {
    pick.qty = Math.min(MAX_QTY, Math.max(1, pick.qty + Number(q.dataset.qty)));
    $('#pmQty').textContent = pick.qty;
  }
});

// Deslizar la foto con el dedo en el celular
let touchX = null;
$('#pmImg').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#pmImg').addEventListener('touchend', (e) => {
  if (touchX === null || current.gallery.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) showPhoto(photo + (dx < 0 ? 1 : -1));
  touchX = null;
});

$('#pmAdd').addEventListener('click', () => {
  if (current.sizes.length && !pick.size) {
    $('#pmError').textContent = 'Elige tu talla para agregarlo a la bolsa.';
    $('#pmError').hidden = false;
    return;
  }
  addToBag(current.id, pick.size, pick.qty);
  closeProduct();
  toast(`${current.name}${pick.size ? ` · talla ${pick.size}` : ''} agregado a tu bolsa`);
});

// ===== BOLSA =====
// Se guarda en este navegador para no perderla al recargar la página
const bagEl = $('#bag');
const BAG_KEY = 'kvBag';
let BAG = [];
try { BAG = JSON.parse(localStorage.getItem(BAG_KEY) || '[]'); } catch (e) { BAG = []; }
if (!Array.isArray(BAG)) BAG = [];

function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(BAG)); } catch (e) {}
}

function addToBag(id, size, qty) {
  const line = BAG.find((l) => l.id === id && l.size === size);
  if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
  else BAG.push({ id, size, qty });
  saveBag();
  renderBag(true);
}

// Productos borrados o agotados desde el panel se descartan solos. Si una talla dejó de existir, se marca.
const bagLines = () => BAG
  .map((l) => ({ ...l, p: findProduct(l.id) }))
  .filter((l) => l.p && !l.p.agotado)
  .map((l) => ({ ...l, sinTalla: !!l.size && !l.p.sizes.includes(l.size) }));
const bagTotal = () => bagLines().reduce((s, l) => s + l.p.price * l.qty, 0);
const aCotizar = () => bagLines().some((l) => !l.p.price);

function renderBag(bump) {
  const lines = bagLines();
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const n = $('#bagCount');
  n.hidden = !units;
  n.textContent = units;
  if (bump) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); }
  const fab = $('.fab');
  fab.hidden = !units;
  $('#fabLabel').textContent = `Mi bolsa (${units}) · ${clp(bagTotal())}`;

  $('#bagList').innerHTML = lines.map((l, i) => `
    <li class="bag-item">
      <img src="${esc(l.p.thumb || l.p.img)}" alt="">
      <div class="bag-item__main">
        <h4>${esc(l.p.name)}</h4>
        <small>${l.size ? `Talla ${esc(l.size)}${l.sinTalla ? ' <em>(ya no disponible)</em>' : ''} · ` : ''}${l.p.price ? clp(l.p.price) : 'A cotizar'}</small>
        <div class="qty">
          <button type="button" data-line="${i}" data-step="-1" aria-label="Menos">−</button>
          <span>${l.qty}</span>
          <button type="button" data-line="${i}" data-step="1" aria-label="Más">+</button>
        </div>
      </div>
      <div class="bag-item__side">
        <strong>${l.p.price ? clp(l.p.price * l.qty) : '—'}</strong>
        <button type="button" class="bag-item__rm" data-remove="${i}" aria-label="Quitar ${esc(l.p.name)}"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>
    </li>`).join('');
  $('#bagEmpty').hidden = !!lines.length;
  $('#bagTitle').textContent = lines.length ? `Tu pedido (${units})` : 'Tu pedido';
  updateOrder();
}

$('#bagList').addEventListener('click', (e) => {
  const lines = bagLines();
  const step = e.target.closest('[data-step]');
  const rm = e.target.closest('[data-remove]');
  const line = step ? lines[step.dataset.line] : rm ? lines[rm.dataset.remove] : null;
  if (!line) return;
  const idx = BAG.findIndex((l) => l.id === line.id && l.size === line.size);
  if (rm || BAG[idx].qty + Number(step.dataset.step) < 1) BAG.splice(idx, 1);
  else BAG[idx].qty = Math.min(MAX_QTY, BAG[idx].qty + Number(step.dataset.step));
  saveBag();
  renderBag();
});

function openBag(encargo) {
  closeProduct();
  renderBag();
  if (encargo) $('#encargoBox').open = true;
  bagEl.classList.add('is-open');
  bagEl.setAttribute('aria-hidden', 'false');
  lockScroll();
  (encargo ? $('#fEncargo') : bagEl.querySelector('.modal__close')).focus();
}
function closeBag() {
  bagEl.classList.remove('is-open');
  bagEl.setAttribute('aria-hidden', 'true');
  lockScroll();
}

// ===== PEDIDO =====
const form = $('#orderForm');
const fRegion = $('#fRegion');
const fComuna = $('#fComuna');
const radio = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';

// Empresas de envío (las elige el dueño en /admin → Ajustes)
$('#fCourier').innerHTML = EMPRESAS
  .map((e, i) => `<label><input type="radio" name="courier" value="${esc(e)}"${i ? '' : ' checked'}><span>${esc(e)}</span></label>`)
  .join('');
$('#fCourier').style.setProperty('--n', Math.max(1, EMPRESAS.length));

function fillRegiones() {
  fRegion.innerHTML = '<option value="">Elige tu región</option>' +
    REGIONES.map((r, i) => `<option value="${i}">${esc(r.region)}</option>`).join('');
}
fRegion.addEventListener('change', () => {
  const r = REGIONES[fRegion.value];
  fComuna.disabled = !r;
  fComuna.innerHTML = r
    ? '<option value="">Elige tu comuna</option>' + r.comunas.map((c) => `<option>${esc(c)}</option>`).join('')
    : '<option value="">Primero la región</option>';
});

function readOrder() {
  const envio = radio('entrega') === 'envio';
  const r = REGIONES[fRegion.value];
  return {
    entrega: radio('entrega'),
    envio,
    nombre: $('#fNombre').value.trim(),
    sector: $('#fSector').value.trim(),
    region: r ? r.region : '',
    comuna: fComuna.value,
    courier: radio('courier'),
    modo: radio('modo'),
    sucursal: $('#fSucursal').value.trim(),
    direccion: $('#fDireccion').value.trim(),
    pago: radio('pago'),
    nota: $('#fNota').value.trim(),
    encargo: $('#fEncargo').value.trim(),
  };
}

// Código corto para identificar el pedido en el chat (ej: KV-4K7Q)
const orderCode = () => 'KV-' + Date.now().toString(36).slice(-4).toUpperCase();
let CODE = orderCode();

// *texto* = negrita y _texto_ = cursiva en WhatsApp
function buildMessage(o) {
  const lines = bagLines();
  const L = [`👑 *PEDIDO ${TIENDA.nombre.toUpperCase()} · ${CODE}* 👑`, '━━━━━━━━━━━━━━━'];
  if (lines.length) {
    L.push('🛒 *Productos*');
    lines.forEach((l, i) => {
      const detalle = [l.size && `Talla ${l.size}`, `x${l.qty}`].filter(Boolean).join(' · ');
      L.push(`${i + 1}. *${l.p.name}* · ${detalle} — ${l.p.price ? clp(l.p.price * l.qty) : '_a cotizar_'}`);
    });
  }
  if (o.encargo) L.push(`📝 *Encargo:* _${o.encargo}_`);
  L.push('━━━━━━━━━━━━━━━');
  L.push(`🙋 *Nombre:* ${o.nombre || '_(por completar)_'}`);
  if (o.envio) {
    L.push(`🚚 *Entrega:* Envío por ${o.courier || '_(por definir)_'} · ${o.modo === 'domicilio' ? 'a domicilio' : 'retiro en sucursal'}`);
    L.push(`📍 *Destino:* ${o.comuna ? `${o.comuna}, ${o.region}` : '_(por completar)_'}`);
    if (o.modo === 'domicilio') L.push(`🏠 *Dirección:* ${o.direccion || '_(por completar)_'}`);
    else L.push(`🏢 *Sucursal:* ${o.sucursal || '_(por completar)_'}`);
  } else {
    L.push(`🤝 *Entrega:* ${ENTREGAS[o.entrega]}`);
    if (o.sector && o.entrega === 'delivery') L.push(`📍 *Comuna:* ${o.sector}`);
  }
  L.push(PAGOS[o.pago] || PAGOS.transferencia);
  if (o.nota) L.push(`💬 *Comentario:* _${o.nota}_`);
  L.push('━━━━━━━━━━━━━━━');
  if (lines.length) {
    L.push(`💰 *TOTAL: ${clp(bagTotal())}*`);
    const extras = [aCotizar() && 'productos a cotizar', o.envio && 'envío por pagar', o.entrega === 'delivery' && 'delivery a coordinar'].filter(Boolean);
    if (extras.length) L.push(`_(+ ${extras.join(' y ')})_`);
    L.push('');
    L.push('¡Hola! Quiero confirmar stock de este pedido 🙌');
  } else {
    L.push('¡Hola! Quiero cotizar este encargo 🙌');
  }
  return L.join('\n');
}

// Vista previa con el formato de WhatsApp
const formatPreview = (text) => esc(text)
  .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
  .replace(/(^|\s|\(|—\s)_([^_\n]+)_/g, '$1<em>$2</em>');

function updateOrder() {
  const o = readOrder();
  const lines = bagLines();
  document.querySelectorAll('[data-envio]').forEach((el) => { el.hidden = !o.envio; });
  document.querySelectorAll('[data-local]').forEach((el) => { el.hidden = o.envio; });
  document.querySelectorAll('[data-sector]').forEach((el) => { el.hidden = o.entrega !== 'delivery'; });
  document.querySelectorAll('[data-modo]').forEach((el) => { el.hidden = el.dataset.modo !== o.modo; });
  // efectivo solo se puede en entregas presenciales
  if (o.envio && o.pago === 'efectivo') { form.querySelector('input[name="pago"][value="transferencia"]').checked = true; o.pago = 'transferencia'; }
  const pagoSeg = $('#fPago');
  pagoSeg.style.setProperty('--n', [...pagoSeg.children].filter((l) => !l.hidden).length);
  const webpay = o.pago === 'webpay';
  document.querySelectorAll('[data-webpay]').forEach((el) => { el.hidden = !webpay; });
  const send = $('#bagSend');
  send.classList.toggle('btn--whatsapp', !webpay);
  send.classList.toggle('btn--primary', webpay);
  send.querySelector('use').setAttribute('href', webpay ? '#i-shield' : '#i-chat');
  send.querySelector('span').textContent = webpay ? `Pagar ${lines.length && !aCotizar() ? clp(bagTotal()) + ' ' : ''}con Webpay` : 'Enviar pedido por WhatsApp';

  const loc = $('#fLocator');
  loc.hidden = o.modo !== 'sucursal' || !COURIERS[o.courier];
  if (COURIERS[o.courier]) {
    loc.href = COURIERS[o.courier];
    loc.innerHTML = `<svg class="ic"><use href="#i-ext"/></svg> Ver sucursales de ${esc(o.courier)}${o.comuna ? ` en ${esc(o.comuna)}` : ''}`;
  }

  $('#bagTotal').textContent = lines.length ? clp(bagTotal()) : '—';
  $('#bagTotalLabel').textContent = aCotizar() ? 'Total (sin productos a cotizar)' : 'Total';
  $('#bagHint').textContent = o.envio
    ? 'El envío va por pagar: lo pagas al recibir o retirar en la sucursal.'
    : o.entrega === 'delivery'
      ? 'El costo del delivery depende de tu comuna: lo coordinamos por WhatsApp.'
      : `Coordinamos contigo por WhatsApp el día y la hora de la entrega en ${TIENDA.punto}.`;
  $('#msgPreview').innerHTML = formatPreview(buildMessage(readOrder()));
}

form.addEventListener('input', updateOrder);
form.addEventListener('change', updateOrder);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const o = readOrder();
  const missing = [];
  if (!bagLines().length && !o.encargo) missing.push('agrega un producto o escribe tu encargo');
  if (!o.nombre) missing.push('tu nombre');
  if (o.entrega === 'delivery' && !o.sector) missing.push('tu comuna');
  if (o.envio) {
    if (!o.comuna) missing.push('región y comuna');
    if (!o.courier) missing.push('la empresa de envío');
    if (o.modo === 'domicilio' && !o.direccion) missing.push('la dirección');
    if (o.modo === 'sucursal' && !o.sucursal) missing.push('la sucursal donde retiras');
  }
  const err = $('#formError');
  if (missing.length) {
    err.textContent = 'Falta: ' + missing.join(', ') + '.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  if (o.pago === 'webpay') { pagarWebpay(o); return; }
  window.open(waUrl(buildMessage(o)), '_blank', 'noopener');
  CODE = orderCode(); // el próximo pedido lleva otro código
  updateOrder();
});

// ===== PAGO CON WEBPAY (Transbank) =====
// El servidor (api/webpay/crear.js) calcula el total con los precios del catálogo y abre la transacción;
// aquí solo se manda al cliente al formulario de Webpay. Al volver, pago.html muestra el resultado.
async function pagarWebpay(o) {
  const err = $('#formError');
  const lines = bagLines();
  const problema = !lines.length ? 'Para pagar con tarjeta agrega productos del catálogo (los encargos se cotizan por WhatsApp).'
    : aCotizar() ? 'Hay productos sin precio en tu bolsa: quítalos o envía el pedido por WhatsApp.'
    : lines.some((l) => l.sinTalla || (l.p.sizes.length && !l.size)) ? 'Revisa la talla de los productos de tu bolsa.'
    : o.encargo ? 'Los encargos se cotizan por WhatsApp: borra el encargo o elige otro medio de pago.'
    : '';
  if (problema) { err.textContent = problema; err.hidden = false; return; }

  const send = $('#bagSend');
  send.disabled = true;
  send.querySelector('span').textContent = 'Conectando con Webpay…';
  try {
    const res = await fetch('/api/webpay/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: lines.map((l) => ({ id: l.id, size: l.size, qty: l.qty })) }),
    });
    const t = await res.json().catch(() => ({}));
    if (!res.ok || !t.url || !t.token) throw new Error(t.error || 'No pudimos conectar con Webpay.');
    // el detalle del pedido queda en este navegador para armar el mensaje de WhatsApp al volver
    try { sessionStorage.setItem('kvPago', JSON.stringify({ orden: t.orden, mensaje: buildMessage(o) })); } catch (e) {}
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = t.url;
    f.innerHTML = `<input type="hidden" name="token_ws" value="${esc(t.token)}">`;
    document.body.appendChild(f);
    f.submit();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    send.disabled = false;
    updateOrder();
  }
}

// ===== EVENTOS GENERALES =====
document.addEventListener('click', (e) => {
  const view = e.target.closest('[data-view]');
  if (view) { openProduct(view.dataset.view); return; }
  if (e.target.closest('[data-encargo]')) { openBag(true); return; }
  if (e.target.closest('[data-open-bag]')) { openBag(); return; }
  if (e.target.closest('[data-close-bag]')) closeBag();
});
document.addEventListener('keydown', (e) => {
  if (pModal.classList.contains('is-open') && current && current.gallery.length > 1) {
    if (e.key === 'ArrowLeft') showPhoto(photo - 1);
    if (e.key === 'ArrowRight') showPhoto(photo + 1);
  }
  if (e.key !== 'Escape') return;
  if (pModal.classList.contains('is-open')) closeProduct();
  else closeBag();
});

['#footerWa', '#contactWa', '#contactWaBtn', '#floatWa'].forEach((s) => { const el = $(s); if (el) el.href = waUrl('Hola! Quiero consultar por un producto 👑'); });

// ===== Aparición suave de las secciones al hacer scroll =====
const reveal = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const ro = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { target.classList.add('is-in'); ro.unobserve(target); }
  }), { threshold: 0.12 });
  reveal.forEach((el) => ro.observe(el));
} else {
  reveal.forEach((el) => el.classList.add('is-in'));
}

// ===== REELS: se descargan al acercarse a la sección y solo se reproducen en pantalla =====
const reelVideos = document.querySelectorAll('.reel video');
const loadVideo = (v) => { if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; } };
if (reelVideos.length && 'IntersectionObserver' in window) {
  const near = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); near.unobserve(target); }
  }), { rootMargin: '600px 0px' });
  const io = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); target.play().catch(() => {}); } else target.pause();
  }), { threshold: 0.25 });
  reelVideos.forEach((v) => { near.observe(v); io.observe(v); });
} else {
  reelVideos.forEach((v) => { loadVideo(v); v.autoplay = true; v.play().catch(() => {}); });
}

// ===== CARGA DEL CATÁLOGO =====
async function loadProducts() {
  fetch('data/regiones.json')
    .then((r) => r.json())
    .then((d) => { REGIONES = Array.isArray(d.regiones) ? d.regiones : []; fillRegiones(); })
    .catch((e) => console.error(e));
  try {
    const res = await fetch('data/catalogo.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const categorias = Array.isArray(data.categorias) ? data.categorias : [];

    // producto -> categorías a las que pertenece (la categoría es la que dice qué productos tiene)
    const tagsOf = {};
    categorias.forEach((c) => (c.productos || []).forEach((id) => (tagsOf[id] = tagsOf[id] || []).push(c.id)));

    const path = (s) => String(s).replace(/^\//, '');
    FILTERS = [['todos', 'Todos'], ...categorias.map((c) => [c.id, c.nombre])];
    PRODUCTS = (data.productos || []).map((p) => {
      const img = path(p.foto || 'img/logo.jpg');
      const fotos = Array.isArray(p.fotos) ? p.fotos.map(path) : [];
      // versiones livianas que genera el build (si faltan, se usan las originales)
      const minis = Array.isArray(p.minis) && p.minis.length === fotos.length ? p.minis.map(path) : fotos;
      const thumb = p.mini ? path(p.mini) : img;
      return {
        id: p.id,
        name: p.nombre,
        price: Number(p.precio) || 0,
        img,
        gallery: [img, ...fotos],
        thumb,
        thumbs: [thumb, ...minis],
        desc: p.descripcion || '',
        sizes: Array.isArray(p.tallas) ? p.tallas.map(String) : [],
        tags: tagsOf[p.id] || [],
        badge: p.etiqueta || '',
        agotado: !!p.agotado,
      };
    });
  } catch (e) {
    console.error(e);
    return; // conserva el HTML que ya escribió el build
  }
  // sin precios cargados, ordenar por precio no tiene sentido
  if (!PRODUCTS.some((p) => p.price > 0)) document.querySelector('.sort').hidden = true;
  renderFilters('todos');
  renderProducts('todos');
  renderBag();
}

updateOrder();
loadProducts();
