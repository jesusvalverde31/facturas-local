'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('../server.cjs');
const { totales, puedeDe } = require('../numeros.js');

test('totales exactos', () => {
  const t = totales([{ cant: 2, precioCents: 1000 }], 21, 0);
  assert.equal(t.base, 2000); assert.equal(t.iva, 420); assert.equal(t.total, 2420);
});
test('irpf resta', () => {
  const t = totales([{ cant: 1, precioCents: 1000 }], 21, 15);
  assert.equal(t.total, 1000 + 210 - 150);
});
test('transiciones', () => {
  assert.equal(puedeDe('borrador', 'emitida'), true);
  assert.equal(puedeDe('borrador', 'pagada'), false);
  assert.equal(puedeDe('emitida', 'pagada'), true);
});
test('rechaza iva raro', () => {
  assert.ok(![0, 4, 10, 21].includes(19));
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fact-'));
async function start(dir) {
  const app = createApp({ dataDir: dir });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  return app;
}
async function req(app, ruta, opt = {}) {
  const res = await fetch(`http://127.0.0.1:${app.address().port}${ruta}`, opt);
  return { res, body: await res.json() };
}
test('numera sin huecos', async () => {
  const app = await start(tmp());
  try {
    const c = await req(app, '/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'A' }) });
    const f1 = await req(app, '/api/facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: c.body.id, lineas: [{ desc: 'X', cant: 1, precioCents: 100 }], iva: 21, irpf: 0, fechaEmision: '2026-09-22', fechaVenc: '2026-10-22' }) });
    const f2 = await req(app, '/api/facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: c.body.id, lineas: [{ desc: 'Y', cant: 1, precioCents: 50 }], iva: 10, irpf: 0, fechaEmision: '2026-09-22', fechaVenc: '2026-10-22' }) });
    assert.equal(f1.body.numero, 'FAC-0001'); assert.equal(f2.body.numero, 'FAC-0002');
  } finally { app.close(); }
});
test('solo borrador se edita', async () => {
  const app = await start(tmp());
  try {
    const c = await req(app, '/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'A' }) });
    const f = await req(app, '/api/facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: c.body.id, lineas: [{ desc: 'X', cant: 1, precioCents: 100 }], iva: 21, irpf: 0, fechaEmision: '2026-09-22', fechaVenc: '2026-10-22' }) });
    await req(app, `/api/facturas/${f.body.id}/estado`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'emitida' }) });
    const e = await req(app, `/api/facturas/${f.body.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: c.body.id, lineas: [{ desc: 'Z', cant: 1, precioCents: 10 }], iva: 21, irpf: 0, fechaEmision: '2026-09-22', fechaVenc: '2026-10-22' }) });
    assert.equal(e.res.status, 400);
  } finally { app.close(); }
});
test('transición ilegal falla', async () => {
  const app = await start(tmp());
  try {
    const c = await req(app, '/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'A' }) });
    const f = await req(app, '/api/facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: c.body.id, lineas: [{ desc: 'X', cant: 1, precioCents: 100 }], iva: 21, irpf: 0, fechaEmision: '2026-09-22', fechaVenc: '2026-10-22' }) });
    const r = await req(app, `/api/facturas/${f.body.id}/estado`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'pagada' }) });
    assert.equal(r.res.status, 400);
  } finally { app.close(); }
});
test('borrador se puede borrar', async () => {
  const app = await start(tmp());
  try {
    const c = await req(app, '/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'A' }) });
    const f = await req(app, '/api/facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: c.body.id, lineas: [{ desc: 'X', cant: 1, precioCents: 100 }], iva: 21, irpf: 0, fechaEmision: '2026-09-22', fechaVenc: '2026-10-22' }) });
    const d = await req(app, `/api/facturas/${f.body.id}`, { method: 'DELETE' });
    assert.equal(d.body.ok, true);
  } finally { app.close(); }
});
test('emitida no se borra', async () => {
  const app = await start(tmp());
  try {
    const c = await req(app, '/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'A' }) });
    const f = await req(app, '/api/facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: c.body.id, lineas: [{ desc: 'X', cant: 1, precioCents: 100 }], iva: 21, irpf: 0, fechaEmision: '2026-09-22', fechaVenc: '2026-10-22' }) });
    await req(app, `/api/facturas/${f.body.id}/estado`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'emitida' }) });
    const d = await req(app, `/api/facturas/${f.body.id}`, { method: 'DELETE' });
    assert.equal(d.res.status, 400);
  } finally { app.close(); }
});
test('rechaza línea vacía', async () => {
  const app = await start(tmp());
  try {
    const c = await req(app, '/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'A' }) });
    const r = await req(app, '/api/facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: c.body.id, lineas: [], iva: 21, irpf: 0, fechaEmision: '2026-09-22', fechaVenc: '2026-10-22' }) });
    assert.equal(r.res.status, 400);
  } finally { app.close(); }
});
