'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createStore, ValidationError } = require('./storage.cjs');
const { puedeDe } = require('./numeros.js');
const MAX_BODY = 256 * 1024;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/calculos.js', ['calculos.js', 'text/javascript; charset=utf-8']],
]);
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
function respond(res, st, b) { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(b)); }
function readBody(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { req.resume(); throw new HttpError(415, 'Envía JSON.'); }
  return new Promise((resolve, reject) => {
    const ch = []; let len = 0;
    req.on('data', c => { len += c.length; if (len > MAX_BODY) reject(new HttpError(413, 'Muy grande.')); else ch.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON no válido.')); } });
    req.on('error', () => reject(new HttpError(400, 'Interrumpida.')));
  });
}
function valFactura(b, s, isNew = true) {
  if (!s.clientes.some(c => c.id === b.clienteId)) throw new ValidationError('Cliente no válido.');
  if (!Array.isArray(b.lineas) || !b.lineas.length || b.lineas.length > 20) throw new ValidationError('1-20 líneas.');
  for (const l of b.lineas) {
    if (!l || typeof l.desc !== 'string' || !l.desc.trim() || l.desc.trim().length > 120) throw new ValidationError('Línea desc 1-120.');
    if (!Number.isFinite(l.cant) || l.cant <= 0 || l.cant > 10000) throw new ValidationError('Cantidad >0.');
    if (!Number.isInteger(l.precioCents) || l.precioCents < 0) throw new ValidationError('Precio >=0.');
  }
  if (![0, 4, 10, 21].includes(b.iva)) throw new ValidationError('IVA no válido.');
  if (![0, 7, 15].includes(b.irpf)) throw new ValidationError('IRPF no válido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fechaEmision || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.fechaVenc || '')) throw new ValidationError('Fechas AAAA-MM-DD.');
}
function createApp({ dataDir = path.join(__dirname, 'data') } = {}) {
  dataDir = path.resolve(dataDir);
  const store = createStore(dataDir);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const port = server.address().port, host = req.headers.host;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) throw new HttpError(403, 'Solo local.');
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/api/health') return respond(res, 200, { app: 'fabrica-ia-facturas', instance: createHash('sha256').update(dataDir.toLowerCase()).digest('hex').slice(0, 16), recovered: store.recovered });
      if (req.method === 'GET' && url.pathname === '/api/state') return respond(res, 200, store.read());
      if (req.method === 'POST' && url.pathname === '/api/clientes') {
        const b = await readBody(req);
        if (!b || typeof b.nombre !== 'string' || !b.nombre.trim() || b.nombre.trim().length > 100) throw new ValidationError('Nombre 1-100.');
        const c = store.update(s => { const cl = { id: randomUUID(), nombre: b.nombre.trim(), nif: String(b.nif || '').slice(0, 20), createdAt: new Date().toISOString() }; s.clientes.push(cl); return cl; });
        return respond(res, 201, c);
      }
      if (req.method === 'POST' && url.pathname === '/api/facturas') {
        const b = await readBody(req);
        const f = store.update(s => {
          valFactura(b, s, true);
          const numero = `FAC-${String(s.nextNumber).padStart(4, '0')}`;
          s.nextNumber++;
          const now = new Date().toISOString();
          const fac = { id: randomUUID(), numero, clienteId: b.clienteId, lineas: b.lineas.map(l => ({ desc: l.desc.trim(), cant: l.cant, precioCents: l.precioCents })), iva: b.iva, irpf: b.irpf, estado: 'borrador', fechaEmision: b.fechaEmision, fechaVenc: b.fechaVenc, createdAt: now, updatedAt: now };
          s.facturas.push(fac);
          return fac;
        });
        return respond(res, 201, f);
      }
      const mF = url.pathname.match(/^\/api\/facturas\/([^/]+)(\/estado)?$/);
      if (mF) {
        const id = mF[1];
        if (req.method === 'PATCH' && !mF[2]) {
          const b = await readBody(req);
          const f = store.update(s => {
            const fac = s.facturas.find(x => x.id === id);
            if (!fac) throw new HttpError(404, 'No encontrada.');
            if (fac.estado !== 'borrador') throw new ValidationError('Solo borrador se edita.');
            valFactura(b, s, false);
            Object.assign(fac, { clienteId: b.clienteId, lineas: b.lineas, iva: b.iva, irpf: b.irpf, fechaEmision: b.fechaEmision, fechaVenc: b.fechaVenc, updatedAt: new Date().toISOString() });
            return fac;
          });
          return respond(res, 200, f);
        }
        if (req.method === 'DELETE' && !mF[2]) {
          store.update(s => {
            const i = s.facturas.findIndex(x => x.id === id);
            if (i < 0) throw new HttpError(404, 'No encontrada.');
            if (s.facturas[i].estado !== 'borrador') throw new ValidationError('Solo borrador se borra.');
            s.facturas.splice(i, 1);
          });
          return respond(res, 200, { ok: true });
        }
        if (req.method === 'POST' && mF[2]) {
          const b = await readBody(req);
          const f = store.update(s => {
            const fac = s.facturas.find(x => x.id === id);
            if (!fac) throw new HttpError(404, 'No encontrada.');
            if (!puedeDe(fac.estado, b.a)) throw new ValidationError(`No puedes pasar de ${fac.estado} a ${b.a}.`);
            fac.estado = b.a; fac.updatedAt = new Date().toISOString();
            return fac;
          });
          return respond(res, 200, f);
        }
      }
      if (['GET', 'HEAD'].includes(req.method) && staticFiles.has(url.pathname)) {
        const [f, t] = staticFiles.get(url.pathname);
        const content = fs.readFileSync(path.join(__dirname, 'public', f));
        res.writeHead(200, { 'Content-Type': t, 'Content-Length': content.length });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      throw new HttpError(404, 'No encontrado.');
    } catch (e) {
      const st = e instanceof HttpError ? e.status : e instanceof ValidationError ? 400 : 500;
      if (!res.destroyed) respond(res, st, { error: st === 500 ? 'Error interno.' : e.message });
    }
  });
  return server;
}
if (require.main === module) {
  const port = process.env.FACT_PORT === undefined ? 4324 : Number(process.env.FACT_PORT);
  const app = createApp({ dataDir: process.env.FACT_DATA_DIR || path.join(__dirname, 'data') });
  app.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Puerto ${port} ocupado.` : e.message); process.exitCode = 1; });
  app.listen(port, '127.0.0.1', () => console.log(`FacturaPro en http://127.0.0.1:${port}\nCtrl+C para cerrar.`));
}
module.exports = { createApp };
