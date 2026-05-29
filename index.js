const express = require('express');
const multer = require('multer');
const twilio = require('twilio');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_WHATSAPP_FROM;
const BASE_URL     = process.env.BASE_URL;
const CUOTA_ARS    = parseInt(process.env.CUOTA_ARS || '15000');

const client = twilio(TWILIO_SID, TWILIO_TOKEN);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS miembros (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      posicion TEXT,
      telefono TEXT NOT NULL,
      pagado BOOLEAN DEFAULT false,
      token TEXT UNIQUE,
      comprobante_url TEXT,
      pagado_en TIMESTAMP
    )
  `);
  console.log('Base de datos lista');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cuotas del equipo</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f6;min-height:100vh;padding:20px}
    .container{max-width:720px;margin:0 auto}
    h1{font-size:22px;font-weight:600;color:#1a1a1a;margin-bottom:4px}
    .subtitle{font-size:13px;color:#888;margin-bottom:20px}
    .dolar-bar{background:#fff;border-radius:10px;padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;flex-wrap:wrap;border:1px solid #eee}
    .dolar-val{font-weight:600;color:#1a1a1a}
    .dolar-tag{background:#e8f5e9;color:#2e7d32;border-radius:99px;padding:2px 10px;font-size:11px;font-weight:600}
    .dolar-tag.err{background:#fce4ec;color:#c62828}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
    .stat{background:#fff;border-radius:10px;padding:14px;text-align:center;border:1px solid #eee}
    .stat-n{font-size:26px;font-weight:700}
    .stat-l{font-size:12px;color:#888;margin-top:2px}
    .n-ok{color:#2e7d32}.n-bad{color:#c62828}
    .config-bar{background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid #eee}
    .config-bar label{font-size:13px;color:#666}
    .config-bar input{width:120px;padding:6px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px}
    .add-card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #eee}
    .add-card h2{font-size:14px;font-weight:600;color:#444;margin-bottom:12px}
    .add-grid{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end}
    @media(max-width:600px){.add-grid{grid-template-columns:1fr 1fr}}
    .add-grid input{padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;width:100%}
    .btn{padding:8px 16px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .15s}
    .btn:hover{background:#f5f5f5}
    .btn-primary{background:#2e7d32;color:#fff;border-color:#2e7d32}
    .btn-primary:hover{background:#256428}
    .btn-wa{background:#25d366;color:#fff;border-color:#25d366}
    .btn-wa:hover{background:#1ebe59}
    .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
    .filter-btn{padding:6px 14px;border:1px solid #ddd;border-radius:99px;background:#fff;font-size:13px;cursor:pointer;color:#666}
    .filter-btn.active{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
    .bulk-bar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}
    .list{display:flex;flex-direction:column;gap:8px}
    .member{background:#fff;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;border:1px solid #eee;border-left:4px solid #eee}
    .member.deuda{border-left-color:#e53935}
    .member.pago{border-left-color:#43a047}
    .avatar{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0}
    .av-ok{background:#e8f5e9;color:#2e7d32}
    .av-bad{background:#fce4ec;color:#c62828}
    .info{flex:1;min-width:0}
    .name{font-size:14px;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .meta{font-size:12px;color:#888;margin-top:2px}
    .badge{font-size:11px;padding:3px 8px;border-radius:99px;font-weight:600;flex-shrink:0}
    .badge-ok{background:#e8f5e9;color:#2e7d32}
    .badge-bad{background:#fce4ec;color:#c62828}
    .actions{display:flex;gap:6px;flex-shrink:0}
    .icon-btn{width:32px;height:32px;border:1px solid #eee;border-radius:8px;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:background .15s}
    .icon-btn:hover{background:#f5f5f5}
    .empty{text-align:center;padding:40px 20px;color:#aaa;font-size:14px}
    .modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;align-items:center;justify-content:center;padding:20px}
    .modal-bg.open{display:flex}
    .modal{background:#fff;border-radius:16px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto}
    .modal h2{font-size:16px;font-weight:600;margin-bottom:16px}
    .modal img{width:100%;border-radius:8px;border:1px solid #eee}
    .modal-close{float:right;cursor:pointer;font-size:20px;color:#888}
    .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:99px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:200}
    .toast.show{opacity:1}
    .sending{opacity:.6;pointer-events:none}
    .status-send{font-size:11px;color:#888}
  </style>
</head>
<body>
<div class="container">
  <h1>⚽ Cuotas del equipo</h1>
  <p class="subtitle">Panel del tesorero</p>
  <div class="dolar-bar">
    <span style="color:#888">💵 Dólar blue:</span>
    <span class="dolar-val" id="dolar-val">cargando...</span>
    <span class="dolar-tag" id="dolar-tag">⏳</span>
    <span style="color:#bbb;font-size:11px">· dolarapi.com</span>
    <button class="btn" style="margin-left:auto;padding:4px 10px;font-size:12px" onclick="fetchDolar()">↺ Actualizar</button>
  </div>
  <div class="config-bar">
    <label>Cuota mensual:</label>
    <input id="inp-cuota" type="number" value="${CUOTA_ARS}" onchange="render()">
    <span style="font-size:13px;color:#888">ARS</span>
    <span id="cuota-usd" style="font-size:13px;color:#2e7d32;margin-left:4px"></span>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-n" id="s-total">0</div><div class="stat-l">Miembros</div></div>
    <div class="stat"><div class="stat-n n-ok" id="s-ok">0</div><div class="stat-l">Al día ✓</div></div>
    <div class="stat"><div class="stat-n n-bad" id="s-bad">0</div><div class="stat-l">Deben ⚠️</div></div>
  </div>
  <div class="add-card">
    <h2>➕ Agregar miembro</h2>
    <div class="add-grid">
      <input id="inp-nombre" placeholder="Nombre completo" onkeydown="if(event.key==='Enter')agregar()">
      <input id="inp-posicion" placeholder="Posición / Rol" onkeydown="if(event.key==='Enter')agregar()">
      <input id="inp-tel" placeholder="Ej: 5491122334455" onkeydown="if(event.key==='Enter')agregar()">
      <button class="btn btn-primary" onclick="agregar()">Agregar</button>
    </div>
    <p style="font-size:11px;color:#aaa;margin-top:8px">Teléfono con código de país sin + (Argentina: 54 + 9 + área + número)</p>
  </div>
  <div class="bulk-bar">
    <button class="btn btn-wa" id="btn-masivo" onclick="enviarMasivo()">📲 Avisar a todos los deudores</button>
    <span class="status-send" id="status-masivo"></span>
  </div>
  <div class="filters">
    <button class="filter-btn active" onclick="setFiltro('todos',this)">Todos</button>
    <button class="filter-btn" onclick="setFiltro('deuda',this)">⚠️ Deudores</button>
    <button class="filter-btn" onclick="setFiltro('pago',this)">✓ Al día</button>
  </div>
  <div class="list" id="lista"></div>
</div>
<div class="modal-bg" id="modal">
  <div class="modal">
    <span class="modal-close" onclick="cerrarModal()">✕</span>
    <h2 id="modal-title">Comprobante</h2>
    <div id="modal-content"></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
let filtro='todos',dolarBlue=null,miembros=[];
async function fetchDolar(){
  try{
    const res=await fetch('https://dolarapi.com/v1/dolares/blue');
    const data=await res.json();
    dolarBlue=parseFloat(data.venta);
    document.getElementById('dolar-val').textContent='$'+dolarBlue.toLocaleString('es-AR');
    document.getElementById('dolar-tag').textContent='✓ actualizado';
    document.getElementById('dolar-tag').className='dolar-tag';
  }catch{
    document.getElementById('dolar-tag').textContent='✗ sin conexión';
    document.getElementById('dolar-tag').className='dolar-tag err';
  }
  actualizarCuotaUSD();render();
}
function actualizarCuotaUSD(){
  const cuota=getCuota();
  const el=document.getElementById('cuota-usd');
  if(dolarBlue)el.textContent='≈ U\$D '+(cuota/dolarBlue).toFixed(2);
  else el.textContent='';
}
function getCuota(){return parseFloat(document.getElementById('inp-cuota').value)||15000;}
async function cargarMiembros(){
  try{const res=await fetch('/api/miembros');miembros=await res.json();render();}
  catch{toast('No se pudo conectar al servidor');}
}
async function agregar(){
  const nombre=document.getElementById('inp-nombre').value.trim();
  const posicion=document.getElementById('inp-posicion').value.trim();
  const telefono=document.getElementById('inp-tel').value.trim();
  if(!nombre||!telefono){toast('Completá nombre y teléfono');return;}
  try{
    const res=await fetch('/api/miembros',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre,posicion,telefono})});
    if(!res.ok)throw new Error();
    const m=await res.json();
    miembros.push(m);
    document.getElementById('inp-nombre').value='';
    document.getElementById('inp-posicion').value='';
    document.getElementById('inp-tel').value='';
    render();toast(nombre+' agregado ✓');
  }catch{toast('Error al agregar miembro');}
}
async function eliminar(id){
  if(!confirm('¿Eliminar este miembro?'))return;
  try{await fetch('/api/miembros/'+id,{method:'DELETE'});miembros=miembros.filter(m=>m.id!==id);render();toast('Miembro eliminado');}
  catch{toast('Error al eliminar');}
}
async function togglePago(id){
  const m=miembros.find(x=>x.id===id);if(!m)return;
  try{
    const res=await fetch('/api/miembros/'+id+'/pago',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({pagado:!m.pagado})});
    const updated=await res.json();Object.assign(m,updated);render();
    toast(m.pagado?'✓ Marcado como pagado':'Marcado como deudor');
  }catch{toast('Error al actualizar');}
}
async function enviarRecordatorio(id){
  const m=miembros.find(x=>x.id===id);if(!m)return;
  try{
    const res=await fetch('/api/recordatorio/'+id,{method:'POST'});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error);
    toast('📲 Recordatorio enviado a '+m.nombre);
  }catch(err){toast('Error: '+err.message);}
}
async function enviarMasivo(){
  const deudores=miembros.filter(m=>!m.pagado);
  if(!deudores.length){toast('No hay deudores');return;}
  if(!confirm('¿Mandar recordatorio a '+deudores.length+' deudores?'))return;
  const btn=document.getElementById('btn-masivo');
  const status=document.getElementById('status-masivo');
  btn.classList.add('sending');status.textContent='Enviando...';
  try{
    const res=await fetch('/api/recordatorio-masivo',{method:'POST'});
    const data=await res.json();
    toast('📲 Enviado a '+data.enviados+' de '+deudores.length+' deudores');
    status.textContent='Último envío: '+new Date().toLocaleTimeString('es-AR');
  }catch{toast('Error al enviar mensajes');status.textContent='';}
  finally{btn.classList.remove('sending');}
}
async function verComprobante(id){
  const m=miembros.find(x=>x.id===id);
  if(!m||!m.comprobante_url){toast('Sin comprobante');return;}
  document.getElementById('modal-title').textContent='Comprobante — '+m.nombre;
  const content=document.getElementById('modal-content');
  if(m.comprobante_url.endsWith('.pdf')){
    content.innerHTML='<a href="'+m.comprobante_url+'" target="_blank" class="btn btn-primary" style="display:inline-flex">📄 Abrir PDF</a>';
  }else{
    content.innerHTML='<img src="'+m.comprobante_url+'" alt="Comprobante"><p style="font-size:11px;color:#aaa;margin-top:8px;text-align:center">Pagado: '+(m.pagado_en?new Date(m.pagado_en).toLocaleString('es-AR'):'—')+'</p>';
  }
  document.getElementById('modal').classList.add('open');
}
function cerrarModal(){document.getElementById('modal').classList.remove('open');}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===document.getElementById('modal'))cerrarModal();});
function setFiltro(f,btn){
  filtro=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');render();
}
function initials(nombre){return nombre.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function render(){
  actualizarCuotaUSD();
  const cuota=getCuota();
  const total=miembros.length,ok=miembros.filter(m=>m.pagado).length,bad=total-ok;
  document.getElementById('s-total').textContent=total;
  document.getElementById('s-ok').textContent=ok;
  document.getElementById('s-bad').textContent=bad;
  const vis=miembros.filter(m=>filtro==='todos'||(filtro==='pago'&&m.pagado)||(filtro==='deuda'&&!m.pagado));
  const lista=document.getElementById('lista');
  if(!vis.length){lista.innerHTML='<div class="empty">No hay miembros en esta categoría</div>';return;}
  const usdStr=m=>dolarBlue&&!m.pagado?' · U\$D '+(cuota/dolarBlue).toFixed(2):'';
  lista.innerHTML=vis.map(m=>'<div class="member '+(m.pagado?'pago':'deuda')+'">'
    +'<div class="avatar '+(m.pagado?'av-ok':'av-bad')+'">'+initials(m.nombre)+'</div>'
    +'<div class="info"><div class="name">'+m.nombre+'</div>'
    +'<div class="meta">'+m.posicion+(!m.pagado?' · $'+cuota.toLocaleString('es-AR')+usdStr(m):'')+( m.pagado_en?' · Pagó '+new Date(m.pagado_en).toLocaleDateString('es-AR'):'')+' · Tel: '+m.telefono+'</div></div>'
    +'<span class="badge '+(m.pagado?'badge-ok':'badge-bad')+'">'+(m.pagado?'Al día':'Debe')+'</span>'
    +'<div class="actions">'
    +(m.comprobante_url?'<button class="icon-btn" onclick="verComprobante('+m.id+')" title="Ver comprobante">📎</button>':'')
    +(!m.pagado?'<button class="icon-btn" onclick="enviarRecordatorio('+m.id+')" title="Mandar recordatorio">📲</button>':'')
    +'<button class="icon-btn" onclick="togglePago('+m.id+')" title="'+(m.pagado?'Marcar deudor':'Marcar pagado')+'">'+(m.pagado?'↩':'✓')+'</button>'
    +'<button class="icon-btn" onclick="eliminar('+m.id+')" title="Eliminar">🗑</button>'
    +'</div></div>'
  ).join('');
}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3000);}
fetchDolar();cargarMiembros();setInterval(cargarMiembros,30000);
</script>
</body>
</html>`);
});

app.get('/api/miembros', async (req, res) => {
  const result = await pool.query('SELECT * FROM miembros ORDER BY id');
  res.json(result.rows);
});

app.post('/api/miembros', async (req, res) => {
  const { nombre, posicion, telefono } = req.body;
  if (!nombre || !telefono) return res.status(400).json({ error: 'Faltan datos' });
  const token = crypto.randomBytes(16).toString('hex');
  const result = await pool.query(
    'INSERT INTO miembros (nombre, posicion, telefono, token) VALUES ($1, $2, $3, $4) RETURNING *',
    [nombre, posicion || 'Sin especificar', telefono.replace(/\D/g, ''), token]
  );
  res.json(result.rows[0]);
});

app.delete('/api/miembros/:id', async (req, res) => {
  await pool.query('DELETE FROM miembros WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.patch('/api/miembros/:id/pago', async (req, res) => {
  const { pagado } = req.body;
  const result = await pool.query(
    'UPDATE miembros SET pagado=$1, pagado_en=$2 WHERE id=$3 RETURNING *',
    [pagado, pagado ? new Date() : null, req.params.id]
  );
  res.json(result.rows[0]);
});

app.post('/api/recordatorio/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM miembros WHERE id=$1', [req.params.id]);
  const m = result.rows[0];
  if (!m) return res.status(404).json({ error: 'No encontrado' });
  if (m.pagado) return res.status(400).json({ error: 'Ya pagó' });
  const linkPago = BASE_URL + '/pagar/' + m.token;
  const mensaje = '⚽ *¡Hola ' + m.nombre + '!*\n\nTe recordamos que tenés pendiente la cuota social del equipo por *$' + CUOTA_ARS.toLocaleString('es-AR') + ' ARS*.\n\n📎 Hacé tu pago y subí el comprobante en este link:\n' + linkPago + '\n\n¡Gracias y a seguir jugando! 🏆';
  try {
    await client.messages.create({ from: TWILIO_FROM, to: 'whatsapp:+' + m.telefono, body: mensaje });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error Twilio:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recordatorio-masivo', async (req, res) => {
  const result = await pool.query('SELECT * FROM miembros WHERE pagado=false');
  const deudores = result.rows;
  if (!deudores.length) return res.json({ ok: true, enviados: 0 });
  const resultados = [];
  for (const m of deudores) {
    const linkPago = BASE_URL + '/pagar/' + m.token;
    const mensaje = '⚽ *¡Hola ' + m.nombre + '!*\n\nTe recordamos que tenés pendiente la cuota social del equipo por *$' + CUOTA_ARS.toLocaleString('es-AR') + ' ARS*.\n\n📎 Subí tu comprobante acá:\n' + linkPago + '\n\n¡Gracias! 🏆';
    try {
      await client.messages.create({ from: TWILIO_FROM, to: 'whatsapp:+' + m.telefono, body: mensaje });
      resultados.push({ id: m.id, nombre: m.nombre, ok: true });
      console.log('Mensaje enviado a ' + m.nombre + ' (' + m.telefono + ')');
    } catch (err) {
      console.error('Error enviando a ' + m.nombre + ':', err.message);
      resultados.push({ id: m.id, nombre: m.nombre, ok: false, error: err.message });
    }
    await new Promise(r => setTimeout(r, 300));
  }
  res.json({ ok: true, enviados: resultados.filter(r => r.ok).length, resultados });
});

app.get('/pagar/:token', async (req, res) => {
  const result = await pool.query('SELECT * FROM miembros WHERE token=$1', [req.params.token]);
  const m = result.rows[0];
  if (!m) return res.status(404).send('<h2>Link inválido o expirado</h2>');
  if (m.pagado) return res.send('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:400px;margin:60px auto;text-align:center;padding:20px}</style></head><body><div style="font-size:60px">✅</div><div style="font-size:20px;margin:16px 0;color:#2d7a2d">¡' + m.nombre + ', tu cuota ya está registrada!</div><p style="color:#666">Gracias por pagar a tiempo 🏆</p></body></html>');
  res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subir comprobante</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:16px;padding:32px 28px;max-width:420px;width:100%;box-shadow:0 2px 20px rgba(0,0,0,.08)}
.logo{font-size:40px;text-align:center;margin-bottom:8px}
h1{font-size:20px;text-align:center;color:#1a1a1a;margin-bottom:4px}
.sub{font-size:14px;text-align:center;color:#666;margin-bottom:24px}
.monto{background:#f0f9f0;border:1px solid #b8e0b8;border-radius:10px;padding:14px;text-align:center;margin-bottom:24px}
.monto-n{font-size:28px;font-weight:700;color:#2d7a2d}
.monto-l{font-size:13px;color:#555;margin-top:2px}
.drop{border:2px dashed #d0d0d0;border-radius:12px;padding:32px 20px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:16px}
.drop:hover{border-color:#4a90e2;background:#f0f6ff}
.drop-icon{font-size:36px;margin-bottom:8px}
.drop-text{font-size:14px;color:#555}
.drop-sub{font-size:12px;color:#999;margin-top:4px}
input[type=file]{display:none}
.preview{display:none;margin-bottom:16px;text-align:center}
.preview img{max-width:100%;max-height:200px;border-radius:8px;border:1px solid #e0e0e0}
.nombre-archivo{font-size:13px;color:#555;margin-top:8px}
.btn{width:100%;padding:14px;background:#2d7a2d;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer}
.btn:disabled{background:#aaa;cursor:not-allowed}
.msg-ok{display:none;text-align:center;padding:20px 0}
.error{color:#c0392b;font-size:13px;margin-top:8px;text-align:center;display:none}
.progress{display:none;margin-top:12px;font-size:13px;text-align:center;color:#666}
</style></head>
<body><div class="card">
<div class="logo">⚽</div>
<h1>Hola, ${m.nombre}!</h1>
<p class="sub">Subí el comprobante de tu cuota social</p>
<div class="monto"><div class="monto-n">$${CUOTA_ARS.toLocaleString('es-AR')}</div><div class="monto-l">pesos argentinos · cuota mensual</div></div>
<div class="drop" id="drop" onclick="document.getElementById('fileInput').click()">
  <div class="drop-icon">📎</div>
  <div class="drop-text">Tocá para elegir el comprobante</div>
  <div class="drop-sub">JPG, PNG, PDF — máximo 10MB</div>
</div>
<input type="file" id="fileInput" accept="image/*,.pdf" onchange="handleFile(this.files[0])">
<div class="preview" id="preview">
  <img id="previewImg" src="" alt="Vista previa">
  <div class="nombre-archivo" id="nombreArchivo"></div>
</div>
<button class="btn" id="btnEnviar" disabled onclick="enviar()">Enviar comprobante</button>
<div class="error" id="error"></div>
<div class="progress" id="progress">Enviando... ⏳</div>
<div class="msg-ok" id="msgOk"><div style="font-size:56px">🎉</div><p style="font-size:16px;color:#2d7a2d;margin-top:8px;font-weight:500">¡Comprobante recibido!<br>Tu cuota quedó registrada.</p></div>
</div>
<script>
let archivoSeleccionado=null;
const drop=document.getElementById('drop');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.style.borderColor='#4a90e2';});
drop.addEventListener('dragleave',()=>drop.style.borderColor='#d0d0d0');
drop.addEventListener('drop',e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);});
function handleFile(file){
  if(!file)return;
  archivoSeleccionado=file;
  document.getElementById('nombreArchivo').textContent=file.name;
  document.getElementById('preview').style.display='block';
  if(file.type.startsWith('image/')){
    const reader=new FileReader();
    reader.onload=e=>document.getElementById('previewImg').src=e.target.result;
    reader.readAsDataURL(file);
    document.getElementById('previewImg').style.display='block';
  }else{document.getElementById('previewImg').style.display='none';}
  document.getElementById('btnEnviar').disabled=false;
}
async function enviar(){
  if(!archivoSeleccionado)return;
  const btn=document.getElementById('btnEnviar');
  btn.disabled=true;
  document.getElementById('progress').style.display='block';
  document.getElementById('error').style.display='none';
  const fd=new FormData();fd.append('comprobante',archivoSeleccionado);
  try{
    const res=await fetch('/api/comprobante/${m.token}',{method:'POST',body:fd});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'Error al enviar');
    ['drop','preview','btnEnviar','progress'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    document.querySelector('.monto').style.display='none';
    document.querySelector('.sub').style.display='none';
    document.getElementById('msgOk').style.display='block';
  }catch(err){
    document.getElementById('error').textContent=err.message;
    document.getElementById('error').style.display='block';
    btn.disabled=false;
    document.getElementById('progress').style.display='none';
  }
}
</script></body></html>`);
});

app.post('/api/comprobante/:token', upload.single('comprobante'), async (req, res) => {
  const result = await pool.query('SELECT * FROM miembros WHERE token=$1', [req.params.token]);
  const m = result.rows[0];
  if (!m) return res.status(404).json({ error: 'Token inválido' });
  if (m.pagado) return res.status(400).json({ error: 'Ya registrado' });
  if (!req.file) return res.status(400).json({ error: 'Sin archivo' });
  const comprobanteUrl = BASE_URL + '/uploads/' + req.file.filename;
  await pool.query(
    'UPDATE miembros SET pagado=true, comprobante_url=$1, pagado_en=$2 WHERE token=$3',
    [comprobanteUrl, new Date(), req.params.token]
  );
  const mensajeFeliz = '🎉 *¡Gracias ' + m.nombre + '!*\n\nRecibimos tu comprobante y tu cuota quedó registrada. ¡Sos un crack! ⚽🏆\n\nNos vemos en la cancha 💪';
  try {
    await client.messages.create({ from: TWILIO_FROM, to: 'whatsapp:+' + m.telefono, body: mensajeFeliz });
  } catch (err) {
    console.error('Error felicitación:', err.message);
  }
  res.json({ ok: true, comprobanteUrl });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log('Servidor en puerto ' + PORT));
});
