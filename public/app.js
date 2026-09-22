const $ = id => document.getElementById(id);
let S = { clientes: [], facturas: [], nextNumber: 1 };
const FN = window.FactNums;
const fmt = c => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100);
const cli = id => (S.clientes.find(c => c.id === id) || {}).nombre || '?';
async function api(r, o) {
  const res = await fetch(r, { headers: { 'Content-Type': 'application/json' }, ...o });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.error || 'Error');
  return b;
}
async function load() { S = await api('/api/state'); render(); }
function tot(f) { return FN.totales(f.lineas, f.iva, f.irpf); }
function render() {
  const hoy = new Date().toISOString().slice(0, 10);
  let cob = 0, pen = 0, ven = 0;
  for (const f of S.facturas) {
    const t = tot(f).total;
    if (f.estado === 'pagada') cob += t;
    else if (f.estado === 'emitida' || f.estado === 'borrador') pen += t;
    if ((f.estado === 'emitida' && f.fechaVenc < hoy) || f.estado === 'vencida') ven++;
  }
  $('k-cob').textContent = fmt(cob); $('k-pen').textContent = fmt(pen); $('k-ven').textContent = ven;
  $('clientes').innerHTML = S.clientes.map(c => `<li>${c.nombre} ${c.nif || ''}</li>`).join('');
  const est = $('f-est').value;
  const box = $('facturas'); box.innerHTML = '';
  for (const f of S.facturas.filter(x => !est || x.estado === est).slice().reverse()) {
    const t = tot(f);
    const d = document.createElement('div');
    d.className = 'fac';
    d.innerHTML = `<b>${f.numero} · ${cli(f.clienteId)} · ${f.estado}</b><br>${f.fechaEmision}→${f.fechaVenc} · Base ${fmt(t.base)} · Total <b>${fmt(t.total)}</b><br><button data-e="emitida">Emitir</button> <button data-e="pagada">Pagada</button> <button data-e="vencida">Vencida</button> <button data-e="print">🖨</button> <button data-e="del">x</button>`;
    d.querySelectorAll('button').forEach(b => b.onclick = async () => {
      const a = b.dataset.e;
      if (a === 'print') return imprimir(f);
      if (a === 'del') { await api('/api/facturas/' + f.id, { method: 'DELETE' }); await load(); return; }
      try { await api('/api/facturas/' + f.id + '/estado', { method: 'POST', body: JSON.stringify({ a }) }); await load(); }
      catch (e) { alert(e.message); }
    });
    box.appendChild(d);
  }
  graf();
}
function imprimir(f) {
  const t = tot(f);
  $('print').innerHTML = `<h1>${f.numero}</h1><p>Cliente: ${cli(f.clienteId)}</p><p>Emisión ${f.fechaEmision} Vence ${f.fechaVenc}</p><ul>${f.lineas.map(l => `<li>${l.desc} x${l.cant} ${fmt(l.precioCents)}</li>`).join('')}</ul><p>Base ${fmt(t.base)} IVA ${fmt(t.iva)} IRPF -${fmt(t.irpf)}</p><h2>Total ${fmt(t.total)}</h2>`;
  window.print();
}
function graf() {
  const cv = $('graf'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const meses = [...Array(4)].map((_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 3 + i); return d.toISOString().slice(0, 7); });
  const sums = meses.map(m => S.facturas.filter(f => f.fechaEmision.startsWith(m) && f.estado !== 'borrador').reduce((a, f) => a + tot(f).total, 0));
  const max = Math.max(1, ...sums), bw = cv.width / 4;
  meses.forEach((m, i) => {
    const h = (cv.height - 40) * (sums[i] / max);
    ctx.fillStyle = '#2563eb'; ctx.fillRect(i * bw + bw * 0.3, cv.height - 25 - h, bw * 0.4, h);
    ctx.fillStyle = '#172554'; ctx.textAlign = 'center'; ctx.fillText(m, i * bw + bw / 2, cv.height - 8);
  });
}
$('f-cli').onsubmit = async e => { e.preventDefault(); await api('/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: $('c-nombre').value, nif: $('c-nif').value }) }); e.target.reset(); await load(); };
$('btn-nueva').onclick = () => {
  if (!S.clientes.length) { alert('Crea un cliente primero.'); return; }
  $('m-cli').innerHTML = S.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  $('m-emi').value = new Date().toISOString().slice(0, 10);
  $('m-ven').value = new Date().toISOString().slice(0, 10);
  $('modal').showModal();
};
$('m-x').onclick = () => $('modal').close();
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const lineas = $('m-lineas').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [desc, cant, precio] = l.split('|').map(s => s.trim());
    return { desc, cant: Number(cant), precioCents: Math.round(Number(precio) * 100) };
  });
  try {
    await api('/api/facturas', { method: 'POST', body: JSON.stringify({ clienteId: $('m-cli').value, lineas, iva: Number($('m-iva').value), irpf: Number($('m-irpf').value), fechaEmision: $('m-emi').value, fechaVenc: $('m-ven').value }) });
    $('modal').close(); await load();
  } catch (err) { $('m-av').textContent = err.message; }
});
$('f-est').onchange = render;
$('btn-limpiar').onclick = () => { $('f-est').value = ''; render(); };
load().catch(() => alert('Abre ABRIR-FACTURAS.cmd'));
