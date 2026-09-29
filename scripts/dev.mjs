// Servidor local para probar la tienda con el pago Webpay (como en Vercel: dist/ + funciones de api/).
// Uso: npm run dev  →  http://localhost:5600
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 5600;
const require = createRequire(import.meta.url);
process.chdir(ROOT); // las funciones leen data/productos desde aquí, igual que en Vercel

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.yml': 'text/yaml',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/api/')) {
    const file = join(ROOT, normalize(path).replace(/^[\\/]+/, '') + '.js');
    if (!file.startsWith(join(ROOT, 'api')) || !existsSync(file)) { res.statusCode = 404; return res.end('No existe'); }
    try { return await require(file)(req, res); } catch (e) { console.error(e); res.statusCode = 500; return res.end('Error'); }
  }
  let file = join(DIST, normalize(path));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.statusCode = 404; return res.end('No existe'); }
  res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`🛍️  Tienda local en http://localhost:${PORT} (corre antes: npm run build)`));
