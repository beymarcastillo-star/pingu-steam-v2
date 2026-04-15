// =============================================
// PINGU STEAM V2 — app.js
// =============================================

// ── API HELPER ────────────────────────────
async function api(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    try {
        const res = await fetch('/api' + path, opts);
        return res.json();
    } catch (e) {
        console.error('API error:', e);
        return {};
    }
}

// ── AUTENTICACIÓN ─────────────────────────
async function processLogin() {
    const pass = document.getElementById('loginPass').value;
    const res  = await api('/auth/login', 'POST', { password: pass });
    if (res.ok) {
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'block';
        cargarNombreEmpresa();
        openHub();
        initSocket();
    } else {
        document.getElementById('loginError').style.display = 'block';
    }
}

function logout() {
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('auth-container').style.display = 'flex';
}

// ── EMPRESA ───────────────────────────────
async function cargarNombreEmpresa() {
    const d = await api('/config/public');
    if (d.nombre_empresa) {
        document.getElementById('navLogo').textContent  = d.nombre_empresa;
        document.getElementById('loginLogo').textContent = d.nombre_empresa;
        document.title = `Panel — ${d.nombre_empresa}`;
    }
    if (d.logo) {
        document.getElementById('logoPreview').innerHTML =
            `<img src="/img/${d.logo}" alt="logo">`;
    }
    // Rellenar campos de config
    if (d.nombre_empresa) document.getElementById('cfgNombreEmpresa').value = d.nombre_empresa;
    if (d.nombre_bot)     document.getElementById('cfgNombreBot').value     = d.nombre_bot;
    if (d.moneda)         document.getElementById('cfgMoneda').value         = d.moneda;
    if (d.prompt_sistema) document.getElementById('cfgPrompt').value         = d.prompt_sistema;
}

// ── NAVEGACIÓN ────────────────────────────
function openHub() {
    // Subir el slider de vuelta al piso del hub
    document.getElementById('main-nav').style.display = 'none';
    document.getElementById('view-slider').classList.remove('in-panel');
    // Resetear scroll del contenido para la próxima vez
    document.getElementById('content-slide').scrollTop = 0;
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-links button').forEach(b => b.classList.remove('active'));
}

function enterPanel(viewId) {
    // Bajar el slider al piso de contenido
    document.getElementById('main-nav').style.display = 'flex';
    document.getElementById('view-slider').classList.add('in-panel');
    switchView(viewId);
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-links button').forEach(b => b.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    document.getElementById('content-slide').scrollTop = 0;

    const btnId = 'btn-' + viewId.replace('-view', '');
    const btn   = document.getElementById(btnId);
    if (btn) btn.classList.add('active');

    // Cargar datos según sección
    const loaders = {
        'dashboard-view': cargarDashboard,
        'pedidos-view':   () => cargarPedidos('pendiente'),
        'servicios-view': cargarServicios,
        'clientes-view':  cargarClientes,
        'ventas-view':    cargarVentas,
        'admins-view':    cargarAdmins,
        'config-view':    cargarConfig,
        'bot-view':       cargarBotStats
    };
    if (loaders[viewId]) loaders[viewId]();
}

// ── SOCKET.IO ─────────────────────────────
function initSocket() {
    if (typeof io === 'undefined') return;
    const socket = io();

    socket.on('qr', (qrData) => {
        // Mostrar QR como imagen usando la API de Google Charts (sin dependencia extra)
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
        document.getElementById('qrBox').innerHTML = `<img src="${url}" alt="QR"><p>Escanea con WhatsApp</p>`;
    });

    socket.on('connection-status', (status) => {
        const pill   = document.getElementById('waPill');
        const waText = document.getElementById('waStatus');
        const badge  = document.getElementById('botBadge');

        pill.className = 'status-pill ' + (status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected');

        const labels = { connected: 'Conectado', connecting: 'Conectando...', disconnected: 'Desconectado' };
        waText.textContent = labels[status] || status;

        if (badge) {
            badge.className = 'badge ' + (status === 'connected' ? 'active' : status === 'connecting' ? 'pending' : 'closed');
            badge.textContent = labels[status] || status;
        }
    });
}

// ── DASHBOARD ─────────────────────────────
async function cargarDashboard() {
    const [stats, servicios, pedidos] = await Promise.all([
        api('/stats'),
        api('/servicios'),
        api('/pedidos?limit=5&estado=pendiente')
    ]);

    document.getElementById('stat-pedidos').textContent  = stats.pedidosPendientes || 0;
    document.getElementById('stat-ventas').textContent   = `Bs ${stats.ventasHoy || 0}`;
    document.getElementById('stat-stock').textContent    = stats.perfilesLibres || 0;
    document.getElementById('stat-clientes').textContent = stats.totalClientes || 0;

    const badge = document.getElementById('nav-badge-pedidos');
    if (stats.pedidosPendientes > 0) {
        badge.textContent    = stats.pedidosPendientes;
        badge.style.display  = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }

    renderDashboardServicios(servicios);
    renderTabla('tablaUltimosPedidos', pedidos, renderFilaPedidoCompacta, 6);
}

function renderDashboardServicios(servicios) {
    const grid = document.getElementById('dashServicios');
    if (!servicios?.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="ei">🎬</span><p>Agrega servicios en <strong>Catálogo</strong></p></div>`;
        return;
    }
    grid.innerHTML = servicios.map(s => renderServiceCard(s, false)).join('');
}

// ── PEDIDOS ───────────────────────────────
async function cargarPedidos(estado = 'pendiente') {
    const pedidos = await api(`/pedidos?estado=${estado}`);
    renderTabla('tablaPedidos', pedidos, renderFilaPedido, 8);
}

function renderFilaPedido(p) {
    const cls = { pendiente: 'pending', atendido: 'active', cancelado: 'closed' }[p.estado] || 'info';
    return `<tr>
        <td>#${p.id}</td>
        <td>${p.cliente_nombre || '—'}</td>
        <td><a href="https://wa.me/${p.whatsapp}" target="_blank" style="color:var(--accent)">${p.whatsapp || '—'}</a></td>
        <td>${p.servicio_nombre || '—'}</td>
        <td>${p.metodo_pago || '—'}</td>
        <td><span class="badge ${cls}">${p.estado}</span></td>
        <td style="font-size:12px;color:var(--text-muted)">${formatFecha(p.creado_en)}</td>
        <td style="display:flex;gap:6px">
            ${p.estado === 'pendiente' ? `<button class="neon-btn btn-sm" onclick="atenderPedido(${p.id})">Atender</button>` : ''}
            <a href="https://wa.me/${p.whatsapp}" target="_blank" class="neon-btn btn-sm btn-outline">💬</a>
        </td>
    </tr>`;
}

function renderFilaPedidoCompacta(p) {
    const cls = { pendiente: 'pending', atendido: 'active', cancelado: 'closed' }[p.estado] || 'info';
    return `<tr>
        <td>#${p.id}</td>
        <td>${p.cliente_nombre || '—'}</td>
        <td style="font-family:monospace;font-size:12px">${p.whatsapp || '—'}</td>
        <td>${p.servicio_nombre || '—'}</td>
        <td><span class="badge ${cls}">${p.estado}</span></td>
        <td><a href="https://wa.me/${p.whatsapp}" target="_blank" class="neon-btn btn-sm btn-outline">💬</a></td>
    </tr>`;
}

async function atenderPedido(id) {
    await api(`/pedidos/${id}/atender`, 'POST');
    cargarPedidos('pendiente');
    cargarDashboard();
}

// ── CATÁLOGO / SERVICIOS ──────────────────
async function cargarServicios() {
    const [servicios, cuentas] = await Promise.all([api('/servicios'), api('/cuentas')]);
    renderGridServicios(servicios);
    renderTabla('tablaCuentas', cuentas, renderFilaCuenta, 6);
}

function renderGridServicios(servicios) {
    const grid = document.getElementById('gridServicios');
    if (!servicios?.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="ei">🎬</span><p>Sin servicios. Agrega uno para empezar.</p></div>`;
        return;
    }
    grid.innerHTML = servicios.map(s => renderServiceCard(s, true)).join('');
}

function renderServiceCard(s, editable) {
    const libres = s.libres ?? 0;
    const stockCls   = libres === 0 ? 'empty' : libres <= 2 ? 'low' : 'ok';
    const stockLabel = libres === 0 ? '🔴 Sin stock' : `🟢 ${libres} disponible${libres !== 1 ? 's' : ''}`;

    // Imagen de fondo
    const bgStyle = s.imagen
        ? `background-image:url('/img/servicios/${s.imagen}');background-size:cover;background-position:center`
        : '';
    const placeholder = s.imagen ? '' : `<span style="position:relative;z-index:1">🎬</span>`;

    const editBtns = editable ? `
        <button class="upload-btn" onclick="event.stopPropagation();abrirCambiarImagen(${s.id})">🖼️ Imagen</button>
        <button onclick="event.stopPropagation();eliminarServicio(${s.id})"
            style="position:absolute;top:10px;left:10px;z-index:10;background:rgba(255,51,102,0.5);border:none;color:white;border-radius:8px;padding:3px 9px;cursor:pointer;font-size:12px;display:none"
            class="del-btn">✕</button>` : '';

    return `<div class="glass-panel cinematic-card"
        onmouseenter="this.querySelectorAll('.upload-btn,.del-btn').forEach(b=>b.style.display='block')"
        onmouseleave="this.querySelectorAll('.upload-btn,.del-btn').forEach(b=>b.style.display='none')">
        <div class="card-img" style="${bgStyle}">
            ${placeholder}
            ${editBtns}
        </div>
        <div class="card-content">
            <span class="card-tag">Streaming</span>
            <h3>${s.nombre}</h3>
            <p>${s.descripcion || 'Servicio de streaming'}</p>
            <div class="card-action">
                <span class="card-stock ${stockCls}">${stockLabel}</span>
            </div>
        </div>
    </div>`;
}

// Abrir modal para cambiar imagen de un servicio existente
function abrirCambiarImagen(id) {
    document.getElementById('imgSvcId').value = id;
    document.getElementById('imgSvcPreview').style.display = 'none';
    document.getElementById('imgSvcInput').value = '';
    abrirModal('modalImagenServicio');
}

async function subirImagenServicio() {
    const id    = document.getElementById('imgSvcId').value;
    const input = document.getElementById('imgSvcInput');
    if (!input.files[0]) return alert('Selecciona una imagen primero');

    const form = new FormData();
    form.append('file', input.files[0]);
    form.append('carpeta', 'servicios');

    const up = await fetch('/api/media/upload?carpeta=servicios', { method: 'POST', body: form });
    const data = await up.json();
    if (!data.filename) return alert('Error subiendo imagen');

    await api(`/servicios/${id}/imagen`, 'POST', { imagen: data.filename });
    cerrarModal('modalImagenServicio');
    cargarServicios();
}

async function guardarServicio() {
    const nombre = document.getElementById('svcNombre').value.trim();
    if (!nombre) return alert('El nombre es obligatorio');

    let imagen = null;
    const input = document.getElementById('svcImgInput');
    if (input.files[0]) {
        const form = new FormData();
        form.append('file', input.files[0]);
        const up   = await fetch('/api/media/upload?carpeta=servicios', { method: 'POST', body: form });
        const data = await up.json();
        if (data.filename) imagen = data.filename;
    }

    await api('/servicios', 'POST', { nombre, descripcion: document.getElementById('svcDesc').value.trim(), imagen });
    cerrarModal('modalServicio');
    document.getElementById('svcNombre').value = '';
    document.getElementById('svcDesc').value   = '';
    input.value = '';
    document.getElementById('svcImgPreview').style.display = 'none';
    cargarServicios();
}

async function eliminarServicio(id) {
    if (!confirm('¿Eliminar este servicio?')) return;
    await api(`/servicios/${id}`, 'DELETE');
    cargarServicios();
}

// ── CUENTAS ───────────────────────────────
function renderFilaCuenta(c) {
    const libres = c.perfiles_libres || 0;
    const cls    = libres === 0 ? 'closed' : libres <= 2 ? 'pending' : 'active';
    return `<tr>
        <td>${c.servicio_nombre || '—'}</td>
        <td style="font-family:monospace;font-size:13px">${c.correo}</td>
        <td style="font-family:monospace;font-size:13px">${c.contrasena}</td>
        <td>${c.tipo}</td>
        <td><span class="badge ${cls}">${libres} libres</span></td>
        <td style="display:flex;gap:6px">
            <button class="neon-btn btn-sm btn-outline" onclick="verPerfiles(${c.id})">Perfiles</button>
            <button class="neon-btn btn-sm btn-danger" onclick="eliminarCuenta(${c.id})">✕</button>
        </td>
    </tr>`;
}

function abrirModalCuenta() {
    api('/servicios').then(s => {
        document.getElementById('cuentaServicio').innerHTML =
            s.map(sv => `<option value="${sv.id}">${sv.nombre}</option>`).join('');
    });
    abrirModal('modalCuenta');
}

async function guardarCuenta() {
    const data = {
        servicio_id: parseInt(document.getElementById('cuentaServicio').value),
        correo:      document.getElementById('cuentaCorreo').value.trim(),
        contrasena:  document.getElementById('cuentaPass').value.trim(),
        tipo:        document.getElementById('cuentaTipo').value
    };
    if (!data.correo || !data.contrasena) return alert('Completa todos los campos');
    await api('/cuentas', 'POST', data);
    cerrarModal('modalCuenta');
    cargarServicios();
}

async function eliminarCuenta(id) {
    if (!confirm('¿Eliminar esta cuenta?')) return;
    await api(`/cuentas/${id}`, 'DELETE');
    cargarServicios();
}

async function verPerfiles(_id) {
    alert('Módulo de perfiles — próximamente 🚧');
}

// ── CLIENTES ──────────────────────────────
async function cargarClientes() {
    const clientes = await api('/clientes');
    renderTabla('tablaClientes', clientes, c => `<tr>
        <td>#${c.id}</td>
        <td>${c.nombre || '—'}</td>
        <td style="font-family:monospace"><a href="https://wa.me/${c.whatsapp}" target="_blank" style="color:var(--accent)">${c.whatsapp}</a></td>
        <td style="font-size:12px;color:var(--text-muted)">${formatFecha(c.registrado_en)}</td>
        <td><a href="https://wa.me/${c.whatsapp}" target="_blank" class="neon-btn btn-sm btn-outline">💬 Escribir</a></td>
    </tr>`, 5);
}

// ── VENTAS ────────────────────────────────
async function cargarVentas() {
    const data = await api('/ventas');
    document.getElementById('ventasHoy').textContent = `Bs ${data.resumen?.hoy || 0}`;
    document.getElementById('ventasMes').textContent = `Bs ${data.resumen?.mes || 0}`;
    renderTabla('tablaVentas', data.ventas || [], v => `<tr>
        <td>#${v.id}</td>
        <td>${v.cliente_nombre || '—'}</td>
        <td>${v.servicio_nombre || '—'} / ${v.nombre_perfil || '—'}</td>
        <td style="color:var(--success);font-weight:600">Bs ${v.precio}</td>
        <td style="font-size:12px;color:var(--text-muted)">${formatFecha(v.fecha)}</td>
    </tr>`, 5);
}

// ── ADMINS ────────────────────────────────
async function cargarAdmins() {
    const data = await api('/admins');
    renderTabla('tablaAdmins', data.admins || [], a => `<tr>
        <td style="font-weight:600">${a.usuario}</td>
        <td style="font-family:monospace">${a.telefono}</td>
        <td><span class="badge ${a.rol === 'super_admin' ? 'info' : 'pending'}">${a.rol}</span></td>
        <td><span class="badge ${a.activo ? 'active' : 'closed'}">${a.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>${a.rol !== 'super_admin' ? `<button class="neon-btn btn-sm btn-danger" onclick="eliminarAdmin('${a.usuario}')">Eliminar</button>` : '—'}</td>
    </tr>`, 5);
}

async function guardarAdmin() {
    const data = {
        usuario:  document.getElementById('adminUsuario').value.trim(),
        telefono: document.getElementById('adminTelefono').value.trim(),
        rol:      document.getElementById('adminRol').value
    };
    if (!data.usuario || !data.telefono) return alert('Completa todos los campos');
    const res = await api('/admins', 'POST', data);
    if (res.error) return alert(res.error);
    cerrarModal('modalAdmin');
    cargarAdmins();
}

async function eliminarAdmin(usuario) {
    if (!confirm(`¿Eliminar al admin ${usuario}?`)) return;
    const res = await api(`/admins/${usuario}`, 'DELETE');
    if (res.error) return alert(res.error);
    cargarAdmins();
}

// ── BOT ───────────────────────────────────
async function cargarBotStats() {
    const stats = await api('/stats');
    if (document.getElementById('botClientes'))
        document.getElementById('botClientes').textContent = stats.totalClientes || 0;
    if (document.getElementById('botNumero'))
        document.getElementById('botNumero').textContent = process?.env?.ADMIN_NUMBER || '—';
}

async function reconectarBot() { await api('/bot/reconnect', 'POST'); }

// ── CONFIGURACIÓN ─────────────────────────
async function cargarConfig() {
    await cargarNombreEmpresa();
    const pagos = await api('/pagos');
    renderPagos(pagos);
}

async function guardarConfig() {
    const data = {
        nombre_empresa: document.getElementById('cfgNombreEmpresa').value.trim(),
        nombre_bot:     document.getElementById('cfgNombreBot').value.trim(),
        moneda:         document.getElementById('cfgMoneda').value,
        prompt_sistema: document.getElementById('cfgPrompt').value.trim()
    };
    await api('/config', 'POST', data);
    cargarNombreEmpresa();
    mostrarToast('✅ Configuración guardada');
}

async function subirLogo(input) {
    if (!input.files[0]) return;
    const form = new FormData();
    form.append('file', input.files[0]);
    const res  = await fetch('/api/media/logo', { method: 'POST', body: form });
    const data = await res.json();
    if (data.filename) {
        document.getElementById('logoPreview').innerHTML =
            `<img src="/img/${data.filename}" alt="logo">`;
        await api('/config', 'POST', { logo: data.filename });
        cargarNombreEmpresa();
        mostrarToast('✅ Logo actualizado');
    }
}

// ── PAGOS ─────────────────────────────────
function renderPagos(pagos) {
    const grid = document.getElementById('listaPagos');
    if (!pagos?.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="ei">💳</span><p>Sin métodos configurados</p></div>`;
        return;
    }
    grid.innerHTML = pagos.map(p => `
        <div class="glass-panel pago-card">
            <button class="delete-btn" onclick="eliminarPago(${p.id})">✕</button>
            <span class="pago-tipo">${p.tipo}</span>
            <h3>${p.nombre}</h3>
            <p class="pago-detalle">${p.detalle || ''}</p>
            ${p.imagen ? `<img src="/img/qr/${p.imagen}" class="qr-preview" alt="QR">` : ''}
        </div>`
    ).join('');
}

async function guardarPago() {
    const data = {
        nombre:  document.getElementById('pagoNombre').value.trim(),
        tipo:    document.getElementById('pagoTipo').value,
        detalle: document.getElementById('pagoDetalle').value.trim()
    };
    if (!data.nombre) return alert('El nombre es obligatorio');

    const input = document.getElementById('pagoQRInput');
    if (input.files[0]) {
        const form = new FormData();
        form.append('file', input.files[0]);
        const up   = await fetch('/api/media/upload?carpeta=qr', { method: 'POST', body: form });
        const upd  = await up.json();
        if (upd.filename) data.imagen = upd.filename;
    }

    await api('/pagos', 'POST', data);
    cerrarModal('modalPago');
    cargarConfig();
}

async function eliminarPago(id) {
    if (!confirm('¿Eliminar este método de pago?')) return;
    await api(`/pagos/${id}`, 'DELETE');
    cargarConfig();
}

// ── UTILIDADES ────────────────────────────
function renderTabla(tbodyId, items, renderFila, colspan) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!items?.length) {
        tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:36px;color:var(--text-muted)">Sin datos</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map(renderFila).join('');
}

function formatFecha(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function previsualizarImagen(input, previewId) {
    const preview = document.getElementById(previewId);
    if (!input.files[0]) return;
    const reader = new FileReader();
    reader.onload = e => {
        preview.src          = e.target.result;
        preview.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
}

function abrirModal(id)  { document.getElementById(id).classList.add('open'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }

function mostrarToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
        position: 'fixed', bottom: '24px', right: '24px', zIndex: 999,
        background: 'rgba(0,229,255,0.15)', border: '1px solid var(--accent)',
        color: 'white', padding: '12px 20px', borderRadius: '12px',
        backdropFilter: 'blur(8px)', fontSize: '14px', fontWeight: '600',
        animation: 'fadeIn 0.3s ease'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// Cerrar modales al click fuera
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('open');
    }
});

// Inicialización: cargar nombre de empresa en login
window.addEventListener('DOMContentLoaded', () => {
    api('/config/public').then(d => {
        if (d.nombre_empresa) {
            document.getElementById('loginLogo').textContent = d.nombre_empresa;
            document.title = `Panel — ${d.nombre_empresa}`;
        }
    });
});
