'use strict';
// numeros.js: totales en céntimos + transiciones. Compartido.
const IVAS = [0, 4, 10, 21];
const IRPFS = [0, 7, 15];
const ESTADOS = ['borrador', 'emitida', 'pagada', 'vencida'];
const TRANS = { borrador: ['emitida'], emitida: ['pagada', 'vencida'], vencida: ['pagada'], pagada: [] };
function totales(lineas, iva, irpf) {
  const base = lineas.reduce((a, l) => a + l.cant * l.precioCents, 0);
  const tIva = Math.round(base * iva / 100);
  const tIrpf = Math.round(base * irpf / 100);
  return { base, iva: tIva, irpf: tIrpf, total: base + tIva - tIrpf };
}
function puedeDe(a, b) { return (TRANS[a] || []).includes(b); }
if (typeof module !== 'undefined') module.exports = { totales, puedeDe, IVAS, IRPFS, ESTADOS, TRANS };
if (typeof window !== 'undefined') window.FactNums = { totales, puedeDe, IVAS, IRPFS, ESTADOS };
