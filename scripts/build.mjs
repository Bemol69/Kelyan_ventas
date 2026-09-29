// Arma la web para publicar. Vercel lo ejecuta en cada cambio (ver vercel.json).
//  1. Lee tienda.config.json (lo define el desarrollador), data/ajustes.json y data/reels.json (los edita el cliente en /admin)
//  2. Junta data/productos/*.json y data/categorias/*.json en data/catalogo.json
//  3. Copia el sitio a dist/ reemplazando los %%MARCADORES%%, escribe los productos dentro
//     del HTML (para Google) y genera canonical, Open Graph, datos estructurados, robots.txt y sitemap.xml
// Uso local: node scripts/build.mjs  →  servir la carpeta dist/
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });

// ---------- Fotos livianas ----------
// Las tarjetas, la portada y los reels muestran las fotos en tamaño chico:
// se genera una copia WebP del ancho justo en dist/img/_opt/. El nombre lleva un hash del
// contenido, así el navegador la guarda en caché y una foto reemplazada en /admin se ve al tiro.
// Las originales se mantienen (ficha del producto, Google, redes sociales).
// Si sharp no está instalado, se usan las originales.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('⚠️  sharp no está instalado (npm install): se usan las fotos originales'); }
const OPT = 'img/_opt';
const optimizadas = new Map();
function optimizar(src, ancho) {
  const path = String(src || '').replace(/^\//, '');
  if (!sharp || !/\.(jpe?g|png|webp)$/i.test(path) || !existsSync(join(ROOT, path))) return Promise.resolve(path);
  const key = `${path}@${ancho}`;
  if (!optimizadas.has(key)) {
    optimizadas.set(key, (async () => {
      try {
        const buf = readFileSync(join(ROOT, path));
        const out = `${OPT}/${createHash('sha1').update(buf).digest('hex').slice(0, 12)}-${ancho}.webp`;
        mkdirSync(join(DIST, OPT), { recursive: true });
        await sharp(buf).rotate().resize({ width: ancho, withoutEnlargement: true }).webp({ quality: 75 }).toFile(join(DIST, out));
        return out;
      } catch (e) {
        console.warn(`⚠️  No se pudo optimizar ${path}: ${e.message}`);
        return path;
      }
    })());
  }
  return optimizadas.get(key);
}
const MINI = 600; // ancho de las fotos en las tarjetas del catálogo (≈300 px en pantalla, x2 para pantallas retina)
const config = readJson(join(ROOT, 'tienda.config.json'));
const readData = (file) => (existsSync(join(DATA, file)) ? readJson(join(DATA, file)) : {});
const ajustes = readData('ajustes.json');
const reelsData = readData('reels.json'); // 3 fotos o videos de «Así trabajamos» (editable en /admin)

// Manda el dominio propio de site_url; si todavía es un .vercel.app, se usa el dominio de producción de Vercel
const propio = config.site_url && !/\.vercel\.app/.test(config.site_url);
const SITE = (!propio && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : config.site_url || 'http://localhost:5600').replace(/\/$/, '');

// ---------- 1. Datos de la tienda ----------
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const T = {
  nombre: str(config.nombre),
  marca_a: str(config.marca_a) || str(config.nombre),
  marca_b: str(config.marca_b),
  rubro: str(config.rubro),
  schema_tipo: str(config.schema_tipo) || 'Store',
  whatsapp: str(ajustes.whatsapp).replace(/\D/g, ''),
  instagram: str(ajustes.instagram).replace(/^@/, ''),
  tiktok: str(ajustes.tiktok).replace(/^@/, ''),
  email: str(ajustes.email),
  punto: str(ajustes.punto_entrega),
  ciudad: str(ajustes.ciudad),
  region: str(ajustes.region),
  envios: str(ajustes.envios) || 'Envíos a todo Chile',
  empresas_envio: (Array.isArray(ajustes.empresas_envio) && ajustes.empresas_envio.length ? ajustes.empresas_envio : ['Starken']).map(str).filter(Boolean),
  horario_dias: str(ajustes.horario_dias),
  hora_abre: str(ajustes.hora_abre),
  hora_cierra: str(ajustes.hora_cierra),
  hero_titulo: str(ajustes.hero_titulo),
  hero_destacado: str(ajustes.hero_destacado),
  hero_bajada: str(ajustes.hero_bajada),
};
T.punto = T.punto || T.ciudad;
T.horario = T.horario_dias && T.hora_abre && T.hora_cierra ? `${T.horario_dias} · ${T.hora_abre} a ${T.hora_cierra}` : '';

// ---------- Reels e imágenes (siempre 3) ----------
const rel = (path) => str(path).replace(/^\//, '');
const REELS_BASE = [
  { archivo: 'img/reels/reel-1.jpg', titulo: 'Stock real', texto: 'Todo listo para entregar', descripcion: 'Stock de ropa de marca listo para entregar' },
  { archivo: 'img/reels/reel-2.jpg', titulo: 'Tallas XS a XL', texto: 'Nuevos ingresos cada semana', descripcion: 'Conjunto de ropa de marca' },
  { archivo: 'img/reels/reel-3.jpg', titulo: 'Haz tu pedido', texto: 'Rápido, fácil y seguro', descripcion: 'Pedidos por WhatsApp' },
];
const listaReels = Array.isArray(reelsData.reels) ? reelsData.reels : [];
const reels = REELS_BASE.map((base, i) => {
  const e = listaReels[i] || {};
  const archivo = rel(e.archivo) || base.archivo;
  return {
    archivo,
    video: /\.(mp4|webm|m4v|mov)$/i.test(archivo),
    titulo: str(e.titulo) || (e.archivo ? '' : base.titulo),
    texto: str(e.texto) || (e.archivo ? '' : base.texto),
    descripcion: str(e.descripcion) || str(e.titulo) || base.descripcion,
  };
});

// ---------- Franjas de texto en movimiento ----------
const FRANJAS = {
  franja1: ['Entrega inmediata', `Entregas en ${T.punto}`, 'Delivery en Santiago', T.envios, 'Tallas XS a XL', 'Compra segura'],
  franja2: ['Premium style', 'Marcas top', 'Nuevos ingresos', 'Calidad garantizada', 'Stock limitado'],
};
function franja(lista) {
  // la cinta se repite hasta tener ~12 frases por mitad, para que el loop no deje huecos en pantallas anchas
  const vuelta = [];
  while (vuelta.length < 12) vuelta.push(...lista);
  return { items: vuelta, segundos: Math.round(vuelta.length * 5) };
}
const F1 = franja(FRANJAS.franja1);
const F2 = franja(FRANJAS.franja2);

const faltan = ['nombre', 'whatsapp', 'ciudad'].filter((k) => !T[k]);
if (faltan.length) throw new Error(`Faltan datos obligatorios: ${faltan.join(', ')} (tienda.config.json / data/ajustes.json)`);
if (!/^\d{10,15}$/.test(T.whatsapp) || (T.whatsapp.startsWith('56') && !/^569\d{8}$/.test(T.whatsapp))) {
  throw new Error(`WhatsApp inválido "${T.whatsapp}": usa formato internacional; en Chile son 11 dígitos, ej 56912345678`);
}

// ---------- 2. Catálogo ----------
function readFolder(folder) {
  const dir = join(DATA, folder);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const file of files) {
    try {
      items.push({ id: basename(file, '.json'), ...readJson(join(dir, file)) });
    } catch (e) {
      // Un archivo dañado no debe botar todo el catálogo: se omite y se avisa en el log
      console.warn(`⚠️  Se omitió ${folder}/${file}: ${e.message}`);
    }
  }
  return items;
}

const num = (v, def) => (v !== '' && v !== null && Number.isFinite(Number(v)) ? Number(v) : def);
const byOrder = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');

const productos = readFolder('productos')
  .filter((p) => p.visible !== false && typeof p.nombre === 'string' && p.nombre.trim())
  .map((p) => ({
    id: p.id,
    nombre: p.nombre.trim(),
    precio: Math.max(0, Math.round(num(p.precio, 0))),
    foto: typeof p.foto === 'string' && p.foto ? p.foto.replace(/^\//, '') : 'img/logo.jpg',
    fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter((f) => typeof f === 'string' && f).map((f) => f.replace(/^\//, '')),
    // tallas únicas y sin vacíos ("S", "M"…); números del CMS se pasan a texto
    tallas: [...new Set((Array.isArray(p.tallas) ? p.tallas : []).map((t) => str(t)).filter(Boolean))],
    descripcion: typeof p.descripcion === 'string' ? p.descripcion.trim() : '',
    etiqueta: typeof p.etiqueta === 'string' ? p.etiqueta.trim() : '',
    agotado: p.agotado === true,
    orden: num(p.orden, 1000),
  }))
  .sort(byOrder)
  .map(({ orden, ...p }) => p);

// Versiones chicas para las tarjetas y miniaturas (la ficha del producto usa las originales)
await Promise.all(productos.map(async (p) => {
  p.mini = await optimizar(p.foto, MINI);
  p.minis = await Promise.all(p.fotos.map((f) => optimizar(f, MINI)));
}));

const ids = new Set(productos.map((p) => p.id));

const categorias = readFolder('categorias')
  .filter((c) => c.visible !== false && typeof c.nombre === 'string' && c.nombre.trim())
  .map((c) => ({
    id: c.id,
    nombre: c.nombre.trim(),
    orden: num(c.orden, 1000),
    // se descartan productos borrados u ocultos, y repetidos
    productos: [...new Set(Array.isArray(c.productos) ? c.productos : [])].filter((id) => ids.has(id)),
  }))
  .sort(byOrder)
  .map(({ orden, ...c }) => c);

writeFileSync(join(DATA, 'catalogo.json'), JSON.stringify({
  _aviso: 'Archivo generado por scripts/build.mjs. No editar a mano.',
  categorias,
  productos,
}, null, 2) + '\n');
console.log(`✅ catálogo: ${productos.length} productos, ${categorias.length} categorías`);

// ---------- 3. Marcadores %%CLAVE%% ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clp = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const abs = (path) => `${SITE}/${String(path).replace(/^\//, '')}`;
const colores = config.colores || {};
const fuentes = config.fuentes || {};
const hero = Array.isArray(config.hero) ? config.hero : [];
const heroFoto = (i) => (hero[i] && hero[i].foto) || (productos[i] && productos[i].foto) || 'img/logo.jpg';
const HERO_OPT = await Promise.all([optimizar(heroFoto(0), 1000), optimizar(heroFoto(1), 520), optimizar(heroFoto(2), 520)]);
const LOGO_OPT = await optimizar('img/logo.jpg', 360);
for (const e of reels) if (!e.video) e.archivo = await optimizar(e.archivo, 700);
const heroAlt = (i) => (hero[i] && hero[i].alt) || (productos[i] && productos[i].nombre) || T.nombre;
const fuenteParam = (f, pesos) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}${pesos ? `:wght@${pesos}` : ''}`;
const FUENTE_TITULOS = fuentes.titulos || 'Cinzel';
const FUENTE_TEXTO = fuentes.texto || 'Montserrat';
const FUENTE_SCRIPT = fuentes.script || 'Great Vibes';

const SEO_TITULO = str(config.seo_titulo) || `${T.nombre} · ${T.rubro} en ${T.ciudad}`;
const SEO_DESCRIPCION = str(config.seo_descripcion) || T.hero_bajada;

const VARS = {
  NOMBRE: T.nombre, MARCA_A: T.marca_a, MARCA_B: T.marca_b, RUBRO: T.rubro,
  SEO_TITULO, SEO_DESCRIPCION,
  CIUDAD: T.ciudad, REGION: T.region, PUNTO: T.punto, ENVIOS: T.envios,
  EMPRESAS: T.empresas_envio.join(' · '),
  WHATSAPP: T.whatsapp, INSTAGRAM: T.instagram, TIKTOK: T.tiktok, EMAIL: T.email, HORARIO: T.horario,
  HERO_TITULO: T.hero_titulo, HERO_DESTACADO: T.hero_destacado, HERO_BAJADA: T.hero_bajada,
  HERO_1: HERO_OPT[0], HERO_1_ALT: heroAlt(0), HERO_2: HERO_OPT[1], HERO_2_ALT: heroAlt(1), HERO_3: HERO_OPT[2], HERO_3_ALT: heroAlt(2),
  LOGO: LOGO_OPT,
  N_PRODUCTOS: String(productos.length),
  FUENTES_URL: `https://fonts.googleapis.com/css2?${fuenteParam(FUENTE_TITULOS, '500;600;700')}&${fuenteParam(FUENTE_TEXTO, '400;500;600;700;800')}&${fuenteParam(FUENTE_SCRIPT)}&display=swap`,
  FUENTE_TITULOS, FUENTE_TEXTO, FUENTE_SCRIPT,
  GITHUB_REPO: str(config.github_repo), SITE_URL: `${SITE}/`,
  COLOR_PRIMARIO: colores.primario, COLOR_PRIMARIO_OSCURO: colores.primario_oscuro, COLOR_PRIMARIO_CLARO: colores.primario_claro,
  COLOR_SECUNDARIO: colores.secundario, COLOR_SECUNDARIO_CLARO: colores.secundario_claro,
  COLOR_ACENTO: colores.acento, COLOR_ACENTO_CLARO: colores.acento_claro,
  COLOR_TINTA: colores.tinta, COLOR_TINTA_SUAVE: colores.tinta_suave,
  COLOR_FONDO: colores.fondo, COLOR_EXTRA: colores.extra, COLOR_DORADO: colores.dorado,
  FRANJA1_SEG: String(F1.segundos), FRANJA2_SEG: String(F2.segundos),
  // Solo lo que necesita el navegador (app.js)
  TIENDA_JSON: JSON.stringify({
    nombre: T.nombre, whatsapp: T.whatsapp, ciudad: T.ciudad, punto: T.punto,
    empresas_envio: T.empresas_envio,
  }),
};

// Bloques opcionales: <!-- SI:CLAVE --> ... <!-- /SI:CLAVE --> se eliminan si CLAVE está vacía
function render(text, file, escape) {
  let out = text;
  for (let prev; prev !== out;) { // se repite para resolver bloques anidados
    prev = out;
    out = out.replace(/<!-- SI:([A-Z0-9_]+) -->([\s\S]*?)<!-- \/SI:\1 -->/g, (m, key, body) => (str(VARS[key]) ? body : ''));
  }
  const missing = new Set();
  out = out.replace(/%%([A-Z0-9_]+)%%/g, (m, key) => {
    const v = VARS[key];
    if (v === undefined || v === null || (v === '' && key.startsWith('COLOR_'))) { missing.add(key); return m; }
    return escape && key !== 'TIENDA_JSON' ? esc(v) : String(v);
  });
  if (missing.size) throw new Error(`${file}: faltan valores para ${[...missing].join(', ')}`);
  return out;
}

// ---------- 4. SEO ----------
const card = (p) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <button class="card__img" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.etiqueta ? `<span class="badge">${esc(p.etiqueta)}</span>` : ''}
        ${p.fotos.length ? `<span class="card__more">+${p.fotos.length} ${p.fotos.length === 1 ? 'foto' : 'fotos'}</span>` : ''}
        <img src="${esc(p.mini)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">
        ${p.minis[0] ? `<img class="alt" src="${esc(p.minis[0])}" alt="" loading="lazy" decoding="async">` : ''}
      </button>
      <div class="card__body">
        <h3>${esc(p.nombre)}</h3>
        ${p.descripcion ? `<p class="card__desc">${esc(p.descripcion)}</p>` : ''}
        ${p.tallas.length ? `<ul class="sizes" aria-label="Tallas disponibles">${p.tallas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <div class="card__foot">
          <span class="price${p.precio > 0 ? '' : ' price--ask'}">${p.precio > 0 ? clp(p.precio) : 'Consultar precio'}</span>
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(`https://api.whatsapp.com/send?phone=${T.whatsapp}&text=${encodeURIComponent(`Hola! ¿Tienen stock de ${p.nombre}?`)}`)}">Consultar stock</a>`
            : `<button class="btn btn--primary btn--sm" type="button" data-view="${esc(p.id)}">${p.tallas.length > 1 ? 'Elegir talla' : 'Agregar'}</button>`}
        </div>
      </div>
    </article>`; // misma tarjeta que card() en app.js

const reelHtml = (e) => `
          <figure class="reel">
            ${e.video
              ? `<video data-src="${esc(e.archivo)}#t=0.1" muted loop playsinline preload="none" aria-label="${esc(e.descripcion)}"></video>`
              : `<img src="${esc(e.archivo)}" alt="${esc(e.descripcion)}" loading="lazy">`}
            ${e.titulo || e.texto ? `<figcaption>${e.titulo ? `<strong>${esc(e.titulo)}</strong>` : ''}${e.texto ? `<span>${esc(e.texto)}</span>` : ''}</figcaption>` : ''}
          </figure>`;

const OG_IMAGE = abs(heroFoto(0));
const precios = productos.map((p) => p.precio).filter((n) => n > 0);
const sameAs = [
  T.instagram && `https://www.instagram.com/${T.instagram}/`,
  T.tiktok && `https://www.tiktok.com/@${T.tiktok}`,
].filter(Boolean);

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': T.schema_tipo,
      '@id': `${SITE}/#tienda`,
      name: T.nombre,
      description: SEO_DESCRIPCION,
      url: `${SITE}/`,
      logo: abs('img/logo.jpg'),
      image: [OG_IMAGE, abs('img/logo.jpg')],
      email: T.email || undefined,
      telephone: `+${T.whatsapp}`,
      // entregas presenciales + delivery en Santiago + envíos a todo Chile
      areaServed: [{ '@type': 'City', name: T.ciudad }, { '@type': 'City', name: 'Santiago' }, { '@type': 'Country', name: 'Chile' }],
      priceRange: precios.length ? `${clp(Math.min(...precios))} – ${clp(Math.max(...precios))}` : undefined,
      currenciesAccepted: 'CLP',
      address: {
        '@type': 'PostalAddress',
        addressLocality: T.ciudad,
        addressRegion: T.region || undefined,
        addressCountry: 'CL',
      },
      sameAs: sameAs.length ? sameAs : undefined,
    },
    {
      '@type': 'ItemList',
      name: 'Catálogo',
      // Google exige precio en los Product: los "Consultar precio" quedan fuera de los datos estructurados
      itemListElement: productos.filter((p) => p.precio > 0).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.nombre,
          image: [p.foto, ...p.fotos].map(abs),
          description: p.descripcion || p.nombre,
          offers: {
            '@type': 'Offer',
            url: `${SITE}/#catalogo`,
            price: p.precio,
            priceCurrency: 'CLP',
            availability: `https://schema.org/${p.agotado ? 'OutOfStock' : 'InStock'}`,
            seller: { '@id': `${SITE}/#tienda` },
          },
        },
      })),
    },
  ],
};

const head = `<link rel="canonical" href="${SITE}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(T.nombre)}">
  <meta property="og:locale" content="es_CL">
  <meta property="og:url" content="${SITE}/">
  <meta property="og:title" content="${esc(SEO_TITULO)}">
  <meta property="og:description" content="${esc(SEO_DESCRIPCION)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">${config.google_verificacion
    ? `\n  <meta name="google-site-verification" content="${esc(config.google_verificacion)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

// ---------- 5. dist/ ----------
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const marker of ['<!-- SEO:HEAD', '<!-- SEO:PRODUCTOS -->', '<!-- REELS:LISTA', '<!-- FRANJA1 -->']) {
  if (!html.includes(marker)) throw new Error(`Falta el marcador ${marker} en index.html`);
}
html = render(html, 'index.html', true)
  .replace(/<!-- SEO:HEAD[^>]*-->/, head)
  .replace('<!-- SEO:PRODUCTOS -->', productos.map(card).join(''))
  .replace(/<!-- REELS:LISTA[^>]*-->/, reels.map(reelHtml).join(''))
  // cada franja lleva sus frases 2 veces seguidas: la animación corre la mitad y vuelve a empezar sin salto
  .replace('<!-- FRANJA1 -->', [...F1.items, ...F1.items].map((t) => `<span>${esc(t)}</span>`).join(''))
  .replaceAll('<!-- FRANJA2 -->', [...F2.items, ...F2.items].map((t) => `<span>${esc(t)}</span>`).join(''));

cpSync(join(ROOT, 'img'), join(DIST, 'img'), { recursive: true });
if (existsSync(join(ROOT, 'favicon.ico'))) cpSync(join(ROOT, 'favicon.ico'), join(DIST, 'favicon.ico')); // Google busca el ícono aquí
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
cpSync(join(DATA, 'catalogo.json'), join(DIST, 'data', 'catalogo.json'));
cpSync(join(DATA, 'regiones.json'), join(DIST, 'data', 'regiones.json'));
// styles.css y app.js llevan ?v=hash: se guardan en caché y cada cambio publicado se descarga de nuevo
const css = render(readFileSync(join(ROOT, 'styles.css'), 'utf8'), 'styles.css', false);
const js = render(readFileSync(join(ROOT, 'app.js'), 'utf8'), 'app.js', false);
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
html = html
  .replace('href="styles.css"', `href="styles.css?v=${version(css)}"`)
  .replace('src="app.js"', `src="app.js?v=${version(js)}"`);
writeFileSync(join(DIST, 'index.html'), html);
// Resultado del pago con Webpay (api/webpay/retorno.js redirige aquí)
writeFileSync(join(DIST, 'pago.html'), render(readFileSync(join(ROOT, 'pago.html'), 'utf8'), 'pago.html', true)
  .replace('href="styles.css"', `href="styles.css?v=${version(css)}"`));
writeFileSync(join(DIST, 'styles.css'), css);
writeFileSync(join(DIST, 'app.js'), js);
writeFileSync(join(DIST, 'admin', 'config.yml'), render(readFileSync(join(ROOT, 'admin', 'config.yml'), 'utf8'), 'admin/config.yml', false));

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`);

if (!existsSync(join(ROOT, 'img', 'logo.jpg'))) console.warn('⚠️  Falta img/logo.jpg (logo de la tienda)');
console.log(`✅ sitio listo en dist/ para ${SITE}`);
