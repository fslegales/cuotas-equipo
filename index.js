const express = require('express');
const multer = require('multer');
const twilio = require('twilio');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Configuración ────────────────────────────────────────────────────────────
const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_WHATSAPP_FROM;  // "whatsapp:+14155238886" (sandbox)
const BASE_URL     = process.env.BASE_URL;               // tu URL de Railway, ej: https://cuotas.up.railway.app
const CUOTA_ARS    = parseInt(process.env.CUOTA_ARS || '15000');

const client = twilio(TWILIO_SID, TWILIO_TOKEN);

// ─── Almacenamiento en memoria (en producción reemplazar con DB) ──────────────
// Estructura: { id, nombre, posicion, telefono, pagado, token, comprobanteUrl, pagadoEn }
let miembros = [];
let nextId = 1;

function guardarEstado() {
  fs.writeFileSync(
    path.join(__dirname, 'estado.json'),
    JSON.stringify({ miembros, nextId }, null, 2)
  );
}

function cargarEstado() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'estado.json'), 'utf8');
    const data = JSON.parse(raw);
    miembros = data.miembros || [];
    nextId   = data.nextId   || 1;
    console.log(`Estado cargado: ${miembros.length} miembros`);
  } catch {
    console.log('Sin estado previo, arrancando limpio');
  }
}

// ─── Multer: guarda comprobantes ──────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// ─── Servir archivos estáticos ────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// ─── API: obtener todos los miembros ─────────────────────────────────────────
app.get('/api/miembros', (req, res) => {
  res.json(miembros);
});

// ─── API: agregar miembro ─────────────────────────────────────────────────────
app.post('/api/miembros', (req, res) => {
  const { nombre, posicion, telefono } = req.body;
  if (!nombre || !telefono) return res.status(400).json({ error: 'Faltan datos' });

  const token = crypto.randomBytes(16).toString('hex');
  const miembro = {
    id: nextId++,
    nombre,
    posicion: posicion || 'Sin especificar',
    telefono: telefono.replace(/\D/g,''), // solo números
    pagado: false,
    token,
    comprobanteUrl: null,
    pagadoEn: null
  };
  miembros.push(miembro);
  guardarEstado();
  res.json(miembro);
});

// ─── API: eliminar miembro ────────────────────────────────────────────────────
app.delete('/api/miembros/:id', (req, res) => {
  miembros = miembros.filter(m => m.id !== parseInt(req.params.id));
  guardarEstado();
  res.json({ ok: true });
});

// ─── API: marcar pagado manualmente (tesorero) ────────────────────────────────
app.patch('/api/miembros/:id/pago', (req, res) => {
  const m = miembros.find(x => x.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: 'No encontrado' });
  m.pagado = req.body.pagado;
  if (m.pagado) m.pagadoEn = new Date().toISOString();
  guardarEstado();
  res.json(m);
});

// ─── API: enviar recordatorio a UN deudor ────────────────────────────────────
app.post('/api/recordatorio/:id', async (req, res) => {
  const m = miembros.find(x => x.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: 'No encontrado' });
  if (m.pagado) return res.status(400).json({ error: 'Ya pagó' });

  const linkPago = `${BASE_URL}/pagar/${m.token}`;
  const mensaje = `⚽ *¡Hola ${m.nombre}!*\n\nTe recordamos que tenés pendiente la cuota social del equipo por *$${CUOTA_ARS.toLocaleString('es-AR')} ARS*.\n\n📎 Hacé tu pago y subí el comprobante en este link:\n${linkPago}\n\n¡Gracias y a seguir jugando! 🏆`;

  try {
    await client.messages.create({
      from: TWILIO_FROM,
      to: `whatsapp:+${m.telefono}`,
      body: mensaje
    });
    res.json({ ok: true, mensaje });
  } catch (err) {
    console.error('Error Twilio:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: enviar recordatorio a TODOS los deudores ───────────────────────────
app.post('/api/recordatorio-masivo', async (req, res) => {
  const deudores = miembros.filter(m => !m.pagado);
  if (!deudores.length) return res.json({ ok: true, enviados: 0 });

  const resultados = [];
  for (const m of deudores) {
    const linkPago = `${BASE_URL}/pagar/${m.token}`;
    const mensaje = `⚽ *¡Hola ${m.nombre}!*\n\nTe recordamos que tenés pendiente la cuota social del equipo por *$${CUOTA_ARS.toLocaleString('es-AR')} ARS*.\n\n📎 Subí tu comprobante acá:\n${linkPago}\n\n¡Gracias! 🏆`;
    try {
      await client.messages.create({
        from: TWILIO_FROM,
        to: `whatsapp:+${m.telefono}`,
        body: mensaje
      });
      resultados.push({ id: m.id, nombre: m.nombre, ok: true });
    } catch (err) {
      resultados.push({ id: m.id, nombre: m.nombre, ok: false, error: err.message });
    }
    // Pequeña pausa entre mensajes para no saturar la API
    await new Promise(r => setTimeout(r, 300));
  }
  res.json({ ok: true, enviados: resultados.filter(r => r.ok).length, resultados });
});

// ─── Página de pago del deudor (por token) ───────────────────────────────────
app.get('/pagar/:token', (req, res) => {
  const m = miembros.find(x => x.token === req.params.token);
  if (!m) return res.status(404).send('<h2>Link inválido o expirado</h2>');

  if (m.pagado) {
    return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ya pagaste</title>
    <style>body{font-family:sans-serif;max-width:400px;margin:60px auto;text-align:center;padding:20px}
    .ok{font-size:60px}.msg{font-size:20px;margin:16px 0;color:#2d7a2d}</style></head>
    <body><div class="ok">✅</div><div class="msg">¡${m.nombre}, tu cuota ya está registrada!</div>
    <p style="color:#666">Gracias por pagar a tiempo 🏆</p></body></html>`);
  }

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Subir comprobante de pago</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:16px;padding:32px 28px;max-width:420px;width:100%;box-shadow:0 2px 20px rgba(0,0,0,.08)}
    .logo{font-size:40px;text-align:center;margin-bottom:8px}
    h1{font-size:20px;text-align:center;color:#1a1a1a;margin-bottom:4px}
    .sub{font-size:14px;text-align:center;color:#666;margin-bottom:24px}
    .monto{background:#f0f9f0;border:1px solid #b8e0b8;border-radius:10px;padding:14px;text-align:center;margin-bottom:24px}
    .monto-n{font-size:28px;font-weight:700;color:#2d7a2d}
    .monto-l{font-size:13px;color:#555;margin-top:2px}
    .drop{border:2px dashed #d0d0d0;border-radius:12px;padding:32px 20px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;margin-bottom:16px}
    .drop:hover,.drop.over{border-color:#4a90e2;background:#f0f6ff}
    .drop-icon{font-size:36px;margin-bottom:8px}
    .drop-text{font-size:14px;color:#555}
    .drop-sub{font-size:12px;color:#999;margin-top:4px}
    input[type=file]{display:none}
    .preview{display:none;margin-bottom:16px;text-align:center}
    .preview img{max-width:100%;max-height:200px;border-radius:8px;border:1px solid #e0e0e0}
    .preview .nombre-archivo{font-size:13px;color:#555;margin-top:8px}
    .btn{width:100%;padding:14px;background:#2d7a2d;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;transition:background .2s}
    .btn:hover{background:#256325}
    .btn:disabled{background:#aaa;cursor:not-allowed}
    .msg-ok{display:none;text-align:center;padding:20px 0}
    .msg-ok .big{font-size:56px}
    .msg-ok p{font-size:16px;color:#2d7a2d;margin-top:8px;font-weight:500}
    .error{color:#c0392b;font-size:13px;margin-top:8px;text-align:center;display:none}
    .progress{display:none;margin-top:12px;font-size:13px;text-align:center;color:#666}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">⚽</div>
  <h1>Hola, ${m.nombre}!</h1>
  <p class="sub">Subí el comprobante de tu cuota social</p>

  <div class="monto">
    <div class="monto-n">$${CUOTA_ARS.toLocaleString('es-AR')}</div>
    <div class="monto-l">pesos argentinos · cuota mensual</div>
  </div>

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

  <div class="msg-ok" id="msgOk">
    <div class="big">🎉</div>
    <p>¡Comprobante recibido!<br>Tu cuota quedó registrada.</p>
  </div>
</div>

<script>
let archivoSeleccionado = null;

const drop = document.getElementById('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); handleFile(e.dataTransfer.files[0]); });

function handleFile(file) {
  if (!file) return;
  archivoSeleccionado = file;
  document.getElementById('nombreArchivo').textContent = file.name;
  document.getElementById('preview').style.display = 'block';
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => document.getElementById('previewImg').src = e.target.result;
    reader.readAsDataURL(file);
    document.getElementById('previewImg').style.display = 'block';
  } else {
    document.getElementById('previewImg').style.display = 'none';
  }
  document.getElementById('btnEnviar').disabled = false;
}

async function enviar() {
  if (!archivoSeleccionado) return;
  const btn = document.getElementById('btnEnviar');
  const progress = document.getElementById('progress');
  const errorEl = document.getElementById('error');
  btn.disabled = true;
  progress.style.display = 'block';
  errorEl.style.display = 'none';

  const fd = new FormData();
  fd.append('comprobante', archivoSeleccionado);

  try {
    const res = await fetch('/api/comprobante/${m.token}', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al enviar');
    document.querySelector('.card > *:not(#msgOk)');
    ['drop','preview','btnEnviar','progress'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.querySelector('.monto').style.display = 'none';
    document.querySelector('.sub').style.display = 'none';
    document.getElementById('msgOk').style.display = 'block';
  } catch(err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    progress.style.display = 'none';
  }
}
</script>
</body>
</html>`);
});

// ─── API: recibir comprobante del deudor ─────────────────────────────────────
app.post('/api/comprobante/:token', upload.single('comprobante'), async (req, res) => {
  const m = miembros.find(x => x.token === req.params.token);
  if (!m) return res.status(404).json({ error: 'Token inválido' });
  if (m.pagado) return res.status(400).json({ error: 'Ya registrado' });
  if (!req.file) return res.status(400).json({ error: 'Sin archivo' });

  // Actualizar estado
  m.pagado = true;
  m.comprobanteUrl = `${BASE_URL}/uploads/${req.file.filename}`;
  m.pagadoEn = new Date().toISOString();
  guardarEstado();

  // Mandar felicitación por WhatsApp
  const mensajeFeliz = `🎉 *¡Gracias ${m.nombre}!*\n\nRecibimos tu comprobante y tu cuota quedó registrada. ¡Sos un crack! ⚽🏆\n\nNos vemos en la cancha 💪`;
  try {
    await client.messages.create({
      from: TWILIO_FROM,
      to: `whatsapp:+${m.telefono}`,
      body: mensajeFeliz
    });
  } catch (err) {
    console.error('Error mandando felicitación:', err.message);
    // No falla el endpoint si el mensaje no sale
  }

  res.json({ ok: true, comprobanteUrl: m.comprobanteUrl });
});

// ─── API: obtener comprobante de un miembro ───────────────────────────────────
app.get('/api/comprobante/:id', (req, res) => {
  const m = miembros.find(x => x.id === parseInt(req.params.id));
  if (!m || !m.comprobanteUrl) return res.status(404).json({ error: 'Sin comprobante' });
  res.json({ url: m.comprobanteUrl });
});

// ─── Arranque ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
cargarEstado();
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
