'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max, req = false) => typeof v === 'string' && v.length <= max && (!req || (v.length > 0 && v === v.trim()));
const isoD = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const fechaD = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
class ValidationError extends Error {}
function validState(s) {
  if (!plain(s) || !Array.isArray(s.clientes) || !Array.isArray(s.facturas) || !Number.isInteger(s.nextNumber) || s.nextNumber < 1) return false;
  const cids = new Set();
  for (const c of s.clientes) {
    if (!plain(c) || !uuid.test(c.id) || cids.has(c.id) || !text(c.nombre, 100, true)) return false;
    cids.add(c.id);
  }
  const nums = new Set();
  for (const f of s.facturas) {
    if (!plain(f) || !uuid.test(f.id) || nums.has(f.numero) || !/^FAC-\d{4}$/.test(f.numero)) return false;
    nums.add(f.numero);
    if (!cids.has(f.clienteId) || !Array.isArray(f.lineas) || !f.lineas.length || f.lineas.length > 20) return false;
    for (const l of f.lineas) {
      if (!plain(l) || !text(l.desc, 120, true) || !Number.isFinite(l.cant) || l.cant <= 0 || !Number.isInteger(l.precioCents) || l.precioCents < 0) return false;
    }
    if (![0, 4, 10, 21].includes(f.iva) || ![0, 7, 15].includes(f.irpf) || !['borrador', 'emitida', 'pagada', 'vencida'].includes(f.estado) || !fechaD(f.fechaEmision) || !fechaD(f.fechaVenc) || !isoD(f.createdAt)) return false;
  }
  return true;
}
function atomicWrite(f, s) {
  const t = `${f}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(t, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(t, f);
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(t)) fs.unlinkSync(t); }
}
function readValid(f) {
  if (!fs.existsSync(f)) return { missing: true };
  try {
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    return validState(s) ? { state: s } : { invalid: true };
  } catch (e) { if (e instanceof SyntaxError) return { invalid: true }; throw e; }
}
function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'facturas.json');
  const backup = path.join(dataDir, 'facturas.backup.json');
  const primary = readValid(file);
  let state, recovered = false;
  if (primary.state) state = primary.state;
  else {
    const prev = readValid(backup);
    if (prev.state) {
      if (!primary.missing) fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
      atomicWrite(file, prev.state); state = prev.state; recovered = true;
    } else if (primary.missing && prev.missing) {
      state = { clientes: [], facturas: [], nextNumber: 1 };
      atomicWrite(backup, state); atomicWrite(file, state);
    } else throw new Error('Datos ilegibles.');
  }
  return {
    recovered,
    read: () => structuredClone(state),
    update(mut) {
      const next = structuredClone(state);
      const r = mut(next);
      if (!validState(next)) throw new Error('Datos no válidos.');
      atomicWrite(backup, state); atomicWrite(file, next); state = next;
      return structuredClone(r);
    }
  };
}
module.exports = { createStore, validState, ValidationError };
