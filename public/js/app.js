// =============================================
// PINGU STEAM V2 — app.js
// Lógica del panel admin
// =============================================

// ── NAVEGACIÓN ────────────────────────────
const pageTitles = {
    dashboard: 'Dashboard',
    pedidos:   'Pedidos',
    servicios: 'Servicios',
    cuentas:   'Cuentas',
    clientes:  'Clientes',
    ventas:    'Ventas',
    admins:    'Administradores',
    whatsapp:  'WhatsApp Bot',
    config:    'Configuración'
};

function goTo(seccion, btn) {
    // Ocultar todas las secciones
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Mostrar la sección elegida
    document.getElementById('sec-' + seccion).classList.add('active');
    document.getElementById('pageTitle').textContent = pageTitles[seccion] || seccion;

    if (btn) btn.classList.add('active');

    // Cargar datos según sección
    const loaders = {
        dashboard: cargarDashboard,
        pedidos:   cargarPedidos,
        servicios: cargarServicios,
        cuentas:   cargarCuentas,
        clientes:  cargarClientes,
        ventas:    cargarVentas,
        admins:    cargarAdmins,
        config:    cargarConfig
    };

    if (loaders[seccion]) loaders[seccion]();
}

// ── API HELPER ────────────────────────────
async function api(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    return res.json();
}

// ── INICIALIZACIÓN ────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    cargarDashboard();
    cargarNombreEmpresa();
    initSocketIO();
});

async function cargarNombreEmpresa() {
    const data = await api('/config/public');
    if (data.nombre_empresa) {
        document.getElementById('sidebarNombre').textContent = data.nombre_empresa;
        document.title = `Panel — ${data.nombre_empresa}`;
    }
    if (data.logo) {
        document.getElementById('sidebarLogo').innerHTML =
            `<img src="/img/${data.logo}" style="width:42px;height:42px;border-radius:12px;object-fit:cover">`;
    }
}

// ── SOCKET.IO (WhatsApp status en tiempo real) ──
function initSocketIO() {
    if (typeof io === 'undefined') return;
    const socket = io();

    socket.on('qr', (qr) => {
        const container = document.getElementById('qrContainer');
        if (!container) return;
        import('https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js').then(() => {
            QRCode.toDataURL(qr, { width: 220 }, (err, url) => {
                if (!err) container.innerHTML = `<img src="${url}" alt="QR"><p>Escanea con WhatsApp</p>`;
            });
        }).catch(() => {
            container.innerHTML = `<p style="word-break:break-all;font-size:10px">${qr}</p><p>Escanea el QR</p>`;
        });
    });

    socket.on('connection-status', (status) => {
        const badge = document.getElementById('waBadge');
        const statusText = document.getElementById('waStatus');
        const infoEstado = document.getElementById('infoEstado');

        badge.className = 'status-badge';
        if (status === 'connected') {
            badge.classList.add('online');
            badge.style.cssText = '';
            statusText.textContent = 'Conectado';
            if (infoEstado) { infoEstado.className = 'badge badge-green'; infoEstado.textContent = 'Conectado'; }
        } else if (status === 'connecting') {
            badge.classList.add('connecting');
            statusText.textContent = 'Conectando...';
            if (infoEstado) { infoEstado.className = 'badge badge-yellow'; infoEstado.textContent = 'Conectando...'; }
        } else {
            badge.classList.add('offline');
            statusText.textContent = 'Desconectado';
            if (infoEstado) { infoEstado.className = 'badge badge-red'; infoEstado.textContent = 'Desconectado'; }
        }
    });
}

// ── DASHBOARD ─────────────────────────────
async function cargarDashboard() {
    const stats = await api('/stats');
    if (stats.pedidosPendientes !== undefined) {
        document.getElementById('stat-pedidos').textContent = stats.pedidosPendientes;
        document.getElementById('stat-ventas').textContent = `Bs ${stats.ventasHoy || 0}`;
        document.getElementById('stat-stock').textContent = stats.perfilesLibres || 0;
        document.getElementById('stat-clientes').textContent = stats.totalClientes || 0;

        const badge = document.getElementById('badge-pedidos');
        if (stats.pedidosPendientes > 0) {
            badge.textContent = stats.pedidosPendientes;
            badge.style.display = 'inline-block';
        }
    }

    // Servicios en cards
    const servicios = await api('/servicios');
    renderDashboardServicios(servicios);

    // Últimos pedidos
    const pedidos = await api('/pedidos?limit=5');
    renderTabla('tablaUltimosPedidos', pedidos, renderFilaPedidoCompacta, 6);
}

function renderDashboardServicios(servicios) {
    const grid = document.getElementById('dashboardServicios');
    if (!servicios || servicios.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <span class="empty-icon">🎬</span>
            <p>Agrega servicios en la sección <strong>Servicios</strong></p>
        </div>`;
        return;
    }

    grid.innerHTML = servicios.map(s => {
        const stockClass = s.libres === 0 ? 'empty' : s.libres <= 2 ? 'low' : 'ok';
        const stockLabel = s.libres === 0 ? 'Sin stock' : `${s.libres} disponible${s.libres > 1 ? 's' : ''}`;
        const bg = s.imagen
            ? `<img class="bg" src="/img/servicios/${s.imagen}" alt="${s.nombre}" onerror="this.style.display='none'">`
            : '';
        const placeholder = !s.imagen
            ? `<div class="bg-placeholder">🎬</div>` : '';

        return `<div class="service-card" onclick="goTo('cuentas', null)">
            ${placeholder}${bg}
            <div class="overlay"></div>
            <div class="content">
                <div class="svc-name">${s.nombre}</div>
                <span class="svc-stock ${stockClass}">${stockLabel}</span>
            </div>
        </div>`;
    }).join('');
}

// ── PEDIDOS ───────────────────────────────
async function cargarPedidos() {
    const filtro = document.getElementById('filtroPedidos')?.value || 'pendiente';
    const pedidos = await api(`/pedidos?estado=${filtro}`);
    renderTabla('tablaPedidos', pedidos, renderFilaPedido, 8);
}

function renderFilaPedido(p) {
    const estadoBadge = {
        pendiente: 'badge-yellow', atendido: 'badge-green', cancelado: 'badge-red'
    }[p.estado] || 'badge-gray';
    return `<tr>
        <td>#${p.id}</td>
        <td>${p.cliente_nombre || '—'}</td>
        <td style="font-family:monospace">${p.whatsapp || '—'}</td>
        <td>${p.servicio_nombre || '—'}</td>
        <td>${p.metodo_pago || '—'}</td>
        <td><span class="badge ${estadoBadge}">${p.estado}</span></td>
        <td style="font-size:12px;color:var(--text-dim)">${formatFecha(p.creado_en)}</td>
        <td>
            ${p.estado === 'pendiente' ? `<button class="btn btn-primary btn-sm" onclick="atenderPedido(${p.id})">Atender</button>` : ''}
            <a href="https://wa.me/${p.whatsapp}" target="_blank" class="btn btn-ghost btn-sm">💬</a>
        </td>
    </tr>`;
}

function renderFilaPedidoCompacta(p) {
    const estadoBadge = { pendiente: 'badge-yellow', atendido: 'badge-green', cancelado: 'badge-red' }[p.estado] || 'badge-gray';
    return `<tr>
        <td>#${p.id}</td>
        <td>${p.cliente_nombre || '—'}</td>
        <td>${p.servicio_nombre || '—'}</td>
        <td><span class="badge ${estadoBadge}">${p.estado}</span></td>
        <td style="font-size:12px;color:var(--text-dim)">${formatFecha(p.creado_en)}</td>
        <td><a href="https://wa.me/${p.whatsapp}" target="_blank" class="btn btn-ghost btn-sm">💬</a></td>
    </tr>`;
}

async function atenderPedido(id) {
    await api(`/pedidos/${id}/atender`, 'POST');
    cargarPedidos();
    cargarDashboard();
}

// ── SERVICIOS ─────────────────────────────
async function cargarServicios() {
    const servicios = await api('/servicios');
    const grid = document.getElementById('gridServicios');

    if (!servicios || servicios.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <span class="empty-icon">🎬</span><p>Sin servicios. Agrega uno para empezar.</p>
        </div>`;
        return;
    }

    grid.innerHTML = servicios.map(s => {
        const stockClass = s.libres === 0 ? 'empty' : s.libres <= 2 ? 'low' : 'ok';
        const bg = s.imagen ? `<img class="bg" src="/img/servicios/${s.imagen}" onerror="this.style.display='none'">` : '';
        const placeholder = !s.imagen ? `<div class="bg-placeholder">🎬</div>` : '';
        return `<div class="service-card">
            ${placeholder}${bg}
            <div class="overlay"></div>
            <div class="content">
                <div class="svc-name">${s.nombre}</div>
                <span class="svc-stock ${stockClass}">${s.libres} disponibles</span>
            </div>
            <button onclick="eliminarServicio(${s.id})" style="position:absolute;top:10px;right:10px;background:rgba(255,0,0,0.4);border:none;color:white;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:12px">✕</button>
        </div>`;
    }).join('');
}

function abrirModalServicio() { abrirModal('modalServicio'); }

async function guardarServicio() {
    const nombre = document.getElementById('svc-nombre').value.trim();
    const descripcion = document.getElementById('svc-descripcion').value.trim();
    const imagenInput = document.getElementById('svc-imagen');

    if (!nombre) return alert('El nombre es obligatorio');

    let imagen = null;
    if (imagenInput.files[0]) {
        const form = new FormData();
        form.append('file', imagenInput.files[0]);
        form.append('carpeta', 'servicios');
        const up = await fetch('/api/media/upload', { method: 'POST', body: form });
        const upData = await up.json();
        if (upData.filename) imagen = upData.filename;
    }

    await api('/servicios', 'POST', { nombre, descripcion, imagen });
    cerrarModal('modalServicio');
    cargarServicios();
}

async function eliminarServicio(id) {
    if (!confirm('¿Eliminar este servicio?')) return;
    await api(`/servicios/${id}`, 'DELETE');
    cargarServicios();
}

// ── CUENTAS ───────────────────────────────
async function cargarCuentas() {
    const cuentas = await api('/cuentas');
    renderTabla('tablaCuentas', cuentas, renderFilaCuenta, 6);
}

function renderFilaCuenta(c) {
    const libres = c.perfiles_libres || 0;
    const stockClass = libres === 0 ? 'badge-red' : libres <= 2 ? 'badge-yellow' : 'badge-green';
    return `<tr>
        <td>${c.servicio_nombre || '—'}</td>
        <td style="font-family:monospace">${c.correo}</td>
        <td>${c.tipo}</td>
        <td><span class="badge ${stockClass}">${libres} libres</span></td>
        <td><span class="badge ${c.activa ? 'badge-green' : 'badge-red'}">${c.activa ? 'Activa' : 'Inactiva'}</span></td>
        <td>
            <button class="btn btn-ghost btn-sm" onclick="verPerfiles(${c.id})">Perfiles</button>
            <button class="btn btn-danger btn-sm" onclick="eliminarCuenta(${c.id})">✕</button>
        </td>
    </tr>`;
}

function abrirModalCuenta() {
    api('/servicios').then(servicios => {
        const sel = document.getElementById('cuenta-servicio');
        sel.innerHTML = servicios.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    });
    abrirModal('modalCuenta');
}

async function guardarCuenta() {
    const data = {
        servicio_id: parseInt(document.getElementById('cuenta-servicio').value),
        correo:      document.getElementById('cuenta-correo').value.trim(),
        contrasena:  document.getElementById('cuenta-password').value.trim(),
        tipo:        document.getElementById('cuenta-tipo').value
    };
    if (!data.correo || !data.contrasena) return alert('Correo y contraseña son obligatorios');
    await api('/cuentas', 'POST', data);
    cerrarModal('modalCuenta');
    cargarCuentas();
}

async function eliminarCuenta(id) {
    if (!confirm('¿Eliminar esta cuenta?')) return;
    await api(`/cuentas/${id}`, 'DELETE');
    cargarCuentas();
}

// ── CLIENTES ──────────────────────────────
async function cargarClientes() {
    const clientes = await api('/clientes');
    renderTabla('tablaClientes', clientes, c => `<tr>
        <td>#${c.id}</td>
        <td>${c.nombre || '—'}</td>
        <td style="font-family:monospace">${c.whatsapp}</td>
        <td style="font-size:12px;color:var(--text-dim)">${formatFecha(c.registrado_en)}</td>
        <td><a href="https://wa.me/${c.whatsapp}" target="_blank" class="btn btn-ghost btn-sm">💬 Escribir</a></td>
    </tr>`, 5);
}

// ── VENTAS ────────────────────────────────
async function cargarVentas() {
    const data = await api('/ventas');
    if (data.resumen) {
        document.getElementById('totalVentasHoy').textContent = `Bs ${data.resumen.hoy || 0}`;
        document.getElementById('totalVentasMes').textContent = `Bs ${data.resumen.mes || 0}`;
    }
    renderTabla('tablaVentas', data.ventas || [], v => `<tr>
        <td>#${v.id}</td>
        <td>${v.cliente_nombre || '—'}</td>
        <td>${v.servicio_nombre || '—'} / ${v.nombre_perfil || '—'}</td>
        <td style="color:var(--success)">Bs ${v.precio}</td>
        <td style="font-size:12px;color:var(--text-dim)">${formatFecha(v.fecha)}</td>
    </tr>`, 5);
}

// ── ADMINS ────────────────────────────────
async function cargarAdmins() {
    const data = await api('/admins');
    renderTabla('tablaAdmins', data.admins || [], a => `<tr>
        <td>${a.usuario}</td>
        <td style="font-family:monospace">${a.telefono}</td>
        <td><span class="badge ${a.rol === 'super_admin' ? 'badge-purple' : 'badge-gray'}">${a.rol}</span></td>
        <td><span class="badge ${a.activo ? 'badge-green' : 'badge-red'}">${a.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>${a.rol !== 'super_admin' ? `<button class="btn btn-danger btn-sm" onclick="eliminarAdmin('${a.usuario}')">Eliminar</button>` : ''}</td>
    </tr>`, 5);
}

function abrirModalAdmin() { abrirModal('modalAdmin'); }

async function guardarAdmin() {
    const data = {
        usuario:  document.getElementById('admin-usuario').value.trim(),
        telefono: document.getElementById('admin-telefono').value.trim(),
        rol:      document.getElementById('admin-rol').value
    };
    if (!data.usuario || !data.telefono) return alert('Usuario y teléfono son obligatorios');
    const res = await api('/admins', 'POST', data);
    if (res.error) return alert(res.error);
    cerrarModal('modalAdmin');
    cargarAdmins();
}

async function eliminarAdmin(usuario) {
    if (!confirm(`¿Eliminar al admin ${usuario}?`)) return;
    await api(`/admins/${usuario}`, 'DELETE');
    cargarAdmins();
}

// ── CONFIGURACIÓN ─────────────────────────
async function cargarConfig() {
    const data = await api('/config/public');
    if (data.nombre_empresa) document.getElementById('cfg-nombre-empresa').value = data.nombre_empresa;
    if (data.nombre_bot)     document.getElementById('cfg-nombre-bot').value = data.nombre_bot;
    if (data.moneda)         document.getElementById('cfg-moneda').value = data.moneda;
    if (data.prompt_sistema) document.getElementById('cfg-prompt').value = data.prompt_sistema;
    if (data.logo) {
        document.getElementById('logoPreview').innerHTML =
            `<img src="/img/${data.logo}" style="width:100px;height:100px;border-radius:16px;object-fit:cover">`;
    }
}

async function guardarConfig() {
    const data = {
        nombre_empresa:  document.getElementById('cfg-nombre-empresa').value.trim(),
        nombre_bot:      document.getElementById('cfg-nombre-bot').value.trim(),
        moneda:          document.getElementById('cfg-moneda').value.trim(),
        prompt_sistema:  document.getElementById('cfg-prompt').value.trim()
    };
    await api('/config', 'POST', data);
    cargarNombreEmpresa();
    alert('✅ Configuración guardada');
}

async function subirLogo(input) {
    if (!input.files[0]) return;
    const form = new FormData();
    form.append('file', input.files[0]);
    form.append('tipo', 'logo');
    const res = await fetch('/api/media/logo', { method: 'POST', body: form });
    const data = await res.json();
    if (data.filename) {
        document.getElementById('logoPreview').innerHTML =
            `<img src="/img/${data.filename}" style="width:100px;height:100px;border-radius:16px;object-fit:cover">`;
        await api('/config', 'POST', { logo: data.filename });
        cargarNombreEmpresa();
    }
}

// Métodos de pago
function abrirModalPago() { abrirModal('modalPago'); }

async function guardarPago() {
    const data = {
        nombre:  document.getElementById('pago-nombre').value.trim(),
        tipo:    document.getElementById('pago-tipo').value,
        detalle: document.getElementById('pago-detalle').value.trim()
    };
    const imagenInput = document.getElementById('pago-imagen');
    if (imagenInput.files[0]) {
        const form = new FormData();
        form.append('file', imagenInput.files[0]);
        form.append('carpeta', 'qr');
        const up = await fetch('/api/media/upload', { method: 'POST', body: form });
        const upData = await up.json();
        if (upData.filename) data.imagen = upData.filename;
    }
    await api('/pagos', 'POST', data);
    cerrarModal('modalPago');
    cargarConfig();
}

// Bot
async function reconectarBot() { await api('/bot/reconnect', 'POST'); }
async function desconectarBot() { if (confirm('¿Desconectar el bot?')) await api('/bot/disconnect', 'POST'); }

// ── UTILIDADES ────────────────────────────
function renderTabla(tbodyId, items, renderFila, colspan) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!items || items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:32px;color:var(--text-dim)">Sin datos</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map(renderFila).join('');
}

function formatFecha(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function abrirModal(id) { document.getElementById(id).classList.add('open'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

function logout() { window.location.href = '/logout'; }

// Cerrar modales al click fuera
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
    });
});
