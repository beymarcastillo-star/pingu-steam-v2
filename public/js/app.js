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
    if (d.tipo_cambio)    document.getElementById('cfgTipoCambio').value     = d.tipo_cambio;
    if (d.prompt_sistema) document.getElementById('cfgPrompt').value         = d.prompt_sistema;
}

// ── FONDOS DINÁMICOS ──────────────────────
const BG_MAP = {
    'hub':            'bg-hub',
    'dashboard-view': 'bg-dashboard',
    'pedidos-view':   'bg-pedidos',
    'servicios-view': 'bg-catalogo',
    'clientes-view':  'bg-clientes',
    'ventas-view':    'bg-ventas',
    'admins-view':    'bg-admins',
    'bot-view':       'bg-bot',
    'pagos-view':     'bg-pagos',
    'config-view':    'bg-config',
};

function changeBackground(key) {
    document.querySelectorAll('.bg-layer').forEach(l => l.classList.remove('active'));
    const targetId = BG_MAP[key];
    if (targetId) document.getElementById(targetId)?.classList.add('active');
}

// Efecto parallax al hacer scroll dentro del panel
document.addEventListener('DOMContentLoaded', () => {
    const contentSlide = document.getElementById('content-slide');
    if (contentSlide) {
        contentSlide.addEventListener('scroll', () => {
            const scrolled = contentSlide.scrollTop;
            document.getElementById('parallax-wrapper').style.transform =
                `translateY(${scrolled * 0.25}px)`;
        });
    }
});

// ── NAVEGACIÓN ────────────────────────────
function openHub() {
    document.getElementById('main-nav').style.display = 'none';
    document.getElementById('view-slider').classList.remove('in-panel');
    document.getElementById('content-slide').scrollTop = 0;
    document.getElementById('parallax-wrapper').style.transform = '';
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-links button').forEach(b => b.classList.remove('active'));
    changeBackground('hub');
}

function enterPanel(viewId) {
    document.getElementById('main-nav').style.display = 'flex';
    document.getElementById('view-slider').classList.add('in-panel');
    switchView(viewId);
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-links button').forEach(b => b.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    document.getElementById('content-slide').scrollTop = 0;
    document.getElementById('parallax-wrapper').style.transform = '';

    const btnId = 'btn-' + viewId.replace('-view', '');
    const btn   = document.getElementById(btnId);
    if (btn) btn.classList.add('active');

    changeBackground(viewId);

    // Cargar datos según sección
    const loaders = {
        'dashboard-view': cargarDashboard,
        'pedidos-view':   () => cargarPedidos('pendiente'),
        'servicios-view': cargarServicios,
        'clientes-view':  cargarClientes,
        'ventas-view':    cargarVentas,
        'admins-view':    cargarAdmins,
        'pagos-view':     cargarPagosView,
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
        const url  = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
        const box  = document.getElementById('qrBox');
        box.innerHTML = `<img src="${url}" alt="QR">`;
        box.classList.add('qr-ready');
        const cap = document.getElementById('qrCaption');
        if (cap) cap.style.color = 'var(--success)';
    });

    let _convDebounce = null;
    socket.on('nueva-conversacion', () => {
        clearTimeout(_convDebounce);
        _convDebounce = setTimeout(() => {
            if (document.getElementById('bot-view')?.classList.contains('active-view'))
                cargarConversaciones();
        }, 600);
    });

    socket.on('connection-status', (status) => {
        const pill   = document.getElementById('waPill');
        const waText = document.getElementById('waStatus');
        const badge  = document.getElementById('botBadge');
        const box    = document.getElementById('qrBox');
        const cap    = document.getElementById('qrCaption');

        pill.className = 'status-pill ' + (status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected');

        const labels = { connected: 'Conectado', connecting: 'Conectando...', disconnected: 'Desconectado' };
        waText.textContent = labels[status] || status;

        if (badge) {
            badge.className = 'badge ' + (status === 'connected' ? 'active' : status === 'connecting' ? 'pending' : 'closed');
            badge.textContent = labels[status] || status;
        }

        if (status === 'connected' && box) {
            box.innerHTML = `<span style="font-size:42px">✅</span><span style="font-size:13px;font-weight:600;color:var(--success)">Conectado</span>`;
            box.classList.remove('qr-ready');
            box.style.borderColor = 'var(--success)';
            box.style.borderStyle = 'solid';
            if (cap) { cap.textContent = 'WhatsApp vinculado'; cap.style.color = 'var(--success)'; }
        } else if (status === 'disconnected' && box && !box.querySelector('img')) {
            box.classList.remove('qr-ready');
            box.style.borderColor = '';
            box.style.borderStyle = '';
            if (cap) { cap.textContent = 'Escanea con WhatsApp'; cap.style.color = ''; }
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

    const bgStyle = s.imagen
        ? `background-image:url('/img/servicios/${s.imagen}');background-size:cover;background-position:center`
        : '';
    const placeholder = s.imagen ? '' : `<span style="position:relative;z-index:1">🎬</span>`;

    // Precios
    let precioHtml = '';
    if (s.precio_usd) {
        const margenCls = s.margen_actual !== null
            ? (s.margen_actual < s.margen_minimo ? 'color:var(--danger)' : 'color:var(--success)')
            : '';
        precioHtml = `
            <div class="card-prices">
                <span class="price-usd">$${s.precio_usd.toFixed(2)}</span>
                <span class="price-bs">Bs ${s.precio_bs?.toFixed(2) ?? '—'}</span>
                ${s.margen_actual !== null ? `<span class="price-margin" style="${margenCls}">${s.margen_actual}% margen</span>` : ''}
            </div>`;
    }

    const editBtns = editable ? `
        <button class="upload-btn" onclick="event.stopPropagation();abrirEditarServicio(${s.id})">✏️ Editar</button>
        <button class="upload-btn" onclick="event.stopPropagation();abrirCambiarImagen(${s.id})" style="top:44px">🖼️ Imagen</button>
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
            ${precioHtml}
            <div class="card-action">
                <span class="card-stock ${stockCls}">${stockLabel}</span>
            </div>
        </div>
    </div>`;
}

// Abrir modal nuevo servicio
async function abrirModalServicio() {
    document.getElementById('svcId').value        = '';
    document.getElementById('svcNombre').value    = '';
    document.getElementById('svcDesc').value      = '';
    document.getElementById('svcPrecioUsd').value = '';
    document.getElementById('svcCostoUsd').value  = '';
    document.getElementById('svcMargen').value    = '20';
    document.getElementById('svcImgPreview').style.display = 'none';
    document.getElementById('svcImgInput').value  = '';
    document.getElementById('preciosPreview').style.display = 'none';
    document.getElementById('modalServicioTitulo').textContent = 'Agregar servicio';

    // Cargar tipo de cambio actual
    const cfg = await api('/config/public');
    document.getElementById('svcTipoCambio').value = cfg.tipo_cambio || '6.96';
    abrirModal('modalServicio');
}

// Abrir modal editar servicio existente
async function abrirEditarServicio(id) {
    const servicios = await api('/servicios');
    const s = servicios.find(x => x.id === id);
    if (!s) return;

    document.getElementById('svcId').value        = id;
    document.getElementById('svcNombre').value    = s.nombre || '';
    document.getElementById('svcDesc').value      = s.descripcion || '';
    document.getElementById('svcPrecioUsd').value = s.precio_usd || '';
    document.getElementById('svcCostoUsd').value  = s.costo_usd || '';
    document.getElementById('svcMargen').value    = s.margen_minimo || 20;
    document.getElementById('svcTipoCambio').value = s.tipo_cambio || 6.96;
    document.getElementById('svcImgPreview').style.display = 'none';
    document.getElementById('svcImgInput').value  = '';
    document.getElementById('modalServicioTitulo').textContent = 'Editar servicio';

    calcularPreciosBs();
    abrirModal('modalServicio');
}

// Calcular preview de precios en tiempo real
function calcularPreciosBs() {
    const precioUsd  = parseFloat(document.getElementById('svcPrecioUsd').value) || 0;
    const costoUsd   = parseFloat(document.getElementById('svcCostoUsd').value) || 0;
    const margen     = parseFloat(document.getElementById('svcMargen').value) || 20;
    const tc         = parseFloat(document.getElementById('svcTipoCambio').value) || 6.96;
    const preview    = document.getElementById('preciosPreview');

    if (!precioUsd && !costoUsd) { preview.style.display = 'none'; return; }
    preview.style.display = 'block';

    document.getElementById('pvUsd').textContent = precioUsd.toFixed(2);
    document.getElementById('pvBs').textContent  = (precioUsd * tc).toFixed(2);

    const precioMinUsd = costoUsd ? +(costoUsd * (1 + margen / 100)).toFixed(2) : null;
    document.getElementById('pvMinUsd').textContent = precioMinUsd ? `${precioMinUsd}` : '—';
    document.getElementById('pvMinBs').textContent  = precioMinUsd ? `${(precioMinUsd * tc).toFixed(2)}` : '—';

    if (costoUsd && precioUsd) {
        const margenReal = ((precioUsd - costoUsd) / costoUsd * 100).toFixed(1);
        const ok = parseFloat(margenReal) >= margen;
        const el = document.getElementById('pvMargen');
        el.textContent = `${margenReal}%`;
        el.style.color = ok ? 'var(--success)' : 'var(--danger)';
    } else {
        document.getElementById('pvMargen').textContent = '—';
        document.getElementById('pvMargen').style.color = 'var(--text-muted)';
    }
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
    if (!nombre) return mostrarToast('❌ El nombre es obligatorio');

    const id         = document.getElementById('svcId').value;
    const precioUsd  = parseFloat(document.getElementById('svcPrecioUsd').value) || null;
    const costoUsd   = parseFloat(document.getElementById('svcCostoUsd').value)  || null;
    const margen     = parseFloat(document.getElementById('svcMargen').value)    || 20;

    // Validar margen si tiene costo y precio
    if (precioUsd && costoUsd) {
        const margenReal = ((precioUsd - costoUsd) / costoUsd * 100);
        if (margenReal < margen) {
            return mostrarToast(`❌ Precio muy bajo — margen real ${margenReal.toFixed(1)}% < mínimo ${margen}%`);
        }
    }

    let imagen = null;
    const input = document.getElementById('svcImgInput');
    if (input.files[0]) {
        const form = new FormData();
        form.append('file', input.files[0]);
        const up   = await fetch('/api/media/upload?carpeta=servicios', { method: 'POST', body: form });
        const data = await up.json();
        if (data.filename) imagen = data.filename;
    }

    const body = {
        nombre,
        descripcion:   document.getElementById('svcDesc').value.trim(),
        precio_usd:    precioUsd,
        costo_usd:     costoUsd,
        margen_minimo: margen,
        ...(imagen ? { imagen } : {})
    };

    if (id) {
        await api(`/servicios/${id}`, 'PUT', body);
    } else {
        await api('/servicios', 'POST', body);
    }

    cerrarModal('modalServicio');
    input.value = '';
    document.getElementById('svcImgPreview').style.display = 'none';
    cargarServicios();
    mostrarToast('✅ Servicio guardado');
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

async function verPerfiles(cuentaId) {
    // Guardar id y cargar título
    document.getElementById('perfilesCuentaId').value = cuentaId;
    document.getElementById('perfilNombre').value = '';
    document.getElementById('perfilPin').value    = '';
    document.getElementById('perfilPrecio').value = '';

    // Buscar nombre de la cuenta para el título
    const cuentas = await api('/cuentas');
    const cuenta  = cuentas.find(c => c.id === cuentaId);
    document.getElementById('modalPerfilesTitulo').textContent =
        `Perfiles — ${cuenta?.servicio_nombre || ''} (${cuenta?.correo || ''})`;

    await recargarPerfiles(cuentaId);
    abrirModal('modalPerfiles');
}

async function recargarPerfiles(cuentaId) {
    const id       = cuentaId || document.getElementById('perfilesCuentaId').value;
    const perfiles = await api(`/perfiles?cuenta_id=${id}`);

    renderTabla('tablaPerfiles', perfiles, p => {
        const esCls = { libre: 'active', vendido: 'closed' }[p.estado] || 'pending';
        const vence = p.fecha_vencimiento
            ? `<span style="font-size:11px">${formatFecha(p.fecha_vencimiento)}</span>`
            : '<span style="color:var(--text-muted);font-size:11px">—</span>';
        const cliente = p.cliente_nombre
            ? `<span style="font-size:12px">${p.cliente_nombre}</span>`
            : '<span style="color:var(--text-muted);font-size:11px">—</span>';

        return `<tr>
            <td style="font-weight:600">${p.nombre_perfil}</td>
            <td style="font-family:monospace;font-size:13px">${p.pin || '—'}</td>
            <td><span class="badge ${esCls}">${p.estado}</span></td>
            <td>${cliente}</td>
            <td>${vence}</td>
            <td style="color:var(--success);font-weight:600">${p.precio_venta ? 'Bs ' + p.precio_venta : '—'}</td>
            <td style="display:flex;gap:4px">
                ${p.estado === 'libre'
                    ? `<button class="neon-btn btn-sm" onclick="marcarVendido(${p.id})">Vender</button>`
                    : `<button class="neon-btn btn-sm btn-outline" onclick="liberarPerfil(${p.id})">Liberar</button>`
                }
                <button class="neon-btn btn-sm btn-danger" onclick="eliminarPerfil(${p.id})">✕</button>
            </td>
        </tr>`;
    }, 7);
}

async function agregarPerfil() {
    const cuenta_id    = document.getElementById('perfilesCuentaId').value;
    const nombre_perfil = document.getElementById('perfilNombre').value.trim();
    const pin          = document.getElementById('perfilPin').value.trim();
    const precio_venta = parseFloat(document.getElementById('perfilPrecio').value) || null;

    if (!nombre_perfil) return mostrarToast('❌ Escribe el nombre del perfil');

    await api('/perfiles', 'POST', { cuenta_id: parseInt(cuenta_id), nombre_perfil, pin, precio_venta });
    document.getElementById('perfilNombre').value = '';
    document.getElementById('perfilPin').value    = '';
    document.getElementById('perfilPrecio').value = '';
    await recargarPerfiles();
    mostrarToast('✅ Perfil agregado');
}

async function marcarVendido(perfilId) {
    const vence = prompt('Fecha de vencimiento (YYYY-MM-DD), opcional:') || null;
    await api(`/perfiles/${perfilId}`, 'PUT', { estado: 'vendido', fecha_vencimiento: vence });
    await recargarPerfiles();
    mostrarToast('✅ Perfil marcado como vendido');
}

async function liberarPerfil(perfilId) {
    await api(`/perfiles/${perfilId}`, 'PUT', { estado: 'libre', cliente_id: null, fecha_vencimiento: null });
    await recargarPerfiles();
    mostrarToast('✅ Perfil liberado');
}

async function eliminarPerfil(perfilId) {
    if (!confirm('¿Eliminar este perfil?')) return;
    await api(`/perfiles/${perfilId}`, 'DELETE');
    await recargarPerfiles();
    mostrarToast('✅ Perfil eliminado');
}

// ── CLIENTES ──────────────────────────────
let _clientesCache = [];

async function cargarClientes() {
    _clientesCache = await api('/clientes');
    renderClientes(_clientesCache);
}

function renderClientes(lista) {
    renderTabla('tablaClientes', lista, c => `<tr>
        <td>#${c.id}</td>
        <td>${c.nombre || '<span style="color:var(--text-muted)">Sin nombre</span>'}</td>
        <td style="font-family:monospace;font-size:13px">
            <a href="https://wa.me/${c.whatsapp}" target="_blank" style="color:var(--accent)">${c.whatsapp}</a>
        </td>
        <td style="text-align:center">
            <span class="badge ${c.puntos > 0 ? 'info' : ''}" style="min-width:48px">⭐ ${c.puntos || 0}</span>
        </td>
        <td style="text-align:center;color:var(--text-muted)">${c.total_compras || 0}</td>
        <td style="font-size:12px;color:var(--text-muted)">${formatFecha(c.registrado_en)}</td>
        <td style="display:flex;gap:6px">
            <button class="neon-btn btn-sm" onclick="verCliente(${c.id})">Ver</button>
            <a href="https://wa.me/${c.whatsapp}" target="_blank" class="neon-btn btn-sm btn-outline">💬</a>
        </td>
    </tr>`, 7);
}

function filtrarClientes(q) {
    if (!q) return renderClientes(_clientesCache);
    const term = q.toLowerCase();
    renderClientes(_clientesCache.filter(c =>
        (c.nombre || '').toLowerCase().includes(term) ||
        c.whatsapp.includes(term)
    ));
}

async function verCliente(id) {
    const data = await api(`/clientes/${id}`);
    document.getElementById('clienteDetalleId').value       = id;
    document.getElementById('modalClienteTitulo').textContent = data.nombre || data.whatsapp;
    document.getElementById('detallePuntos').textContent     = data.puntos || 0;
    document.getElementById('detalleCompras').textContent    = data.total_compras || 0;
    document.getElementById('puntosAjusteCantidad').value    = '';
    document.getElementById('puntosAjusteMotivo').value      = '';

    // Historial de puntos
    renderTabla('tablaHistorialPuntos', data.historial || [], h => `<tr>
        <td><span class="badge ${h.tipo === 'ganado' ? 'active' : 'closed'}">${h.tipo === 'ganado' ? '+ ganado' : '− canjeado'}</span></td>
        <td style="font-weight:600;color:${h.tipo === 'ganado' ? 'var(--success)' : 'var(--danger)'}">${h.tipo === 'ganado' ? '+' : '-'}${h.cantidad}</td>
        <td style="color:var(--text-muted);font-size:12px">${h.motivo || '—'}</td>
        <td style="font-size:11px;color:var(--text-muted)">${formatFecha(h.fecha)}</td>
    </tr>`, 4);

    abrirModal('modalCliente');
}

async function ajustarPuntos(tipo) {
    const id       = document.getElementById('clienteDetalleId').value;
    const cantidad = parseInt(document.getElementById('puntosAjusteCantidad').value);
    const motivo   = document.getElementById('puntosAjusteMotivo').value.trim();

    if (!cantidad || cantidad < 1) return mostrarToast('❌ Ingresa una cantidad válida');

    const res = await api(`/clientes/${id}/puntos`, 'POST', { cantidad, tipo, motivo });
    if (res.error) return mostrarToast('❌ ' + res.error);

    mostrarToast(`✅ Puntos ${tipo === 'ganado' ? 'agregados' : 'descontados'} correctamente`);
    verCliente(id);       // refrescar modal
    cargarClientes();     // refrescar tabla
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
    const [stats, config, pagos] = await Promise.all([
        api('/stats'),
        api('/config/public'),
        api('/pagos')
    ]);

    if (document.getElementById('botClientes'))
        document.getElementById('botClientes').textContent = stats.totalClientes || 0;
    if (document.getElementById('botNumero'))
        document.getElementById('botNumero').textContent = config.admin_number || '—';
    if (document.getElementById('botMetodos'))
        document.getElementById('botMetodos').textContent = pagos?.length || 0;
    if (document.getElementById('botMetodosResumen'))
        document.getElementById('botMetodosResumen').textContent = pagos?.length || 0;

    cargarConversaciones();

    if (config.prompt_sistema && !document.getElementById('cfgPrompt').value)
        document.getElementById('cfgPrompt').value = config.prompt_sistema;

    const sw = document.getElementById('switchGrupos');
    if (sw) sw.checked = config.grupos_activo === '1';
}

async function toggleGrupos(activo) {
    await api('/config', { method: 'POST', body: JSON.stringify({ grupos_activo: activo }) });
}

function tipoLabel(tipo) {
    return { qr: '📷 QR', cuenta: '🏦 Cuenta', yape: '📱 Yape/Tigo', efectivo: '💵 Efectivo' }[tipo] || tipo;
}

async function reconectarBot() { await api('/bot/reconnect', 'POST'); }

// ── PROBAR IA ──────────────────────────────
async function probarIA() {
    const input  = document.getElementById('testIAInput');
    const output = document.getElementById('testIAOutput');
    const msg    = input.value.trim();
    if (!msg) return;

    output.style.display = 'block';
    output.textContent   = '⏳ Pensando...';

    const res = await api('/bot/test-ia', 'POST', { mensaje: msg });
    output.textContent = res.respuesta || res.error || 'Sin respuesta';
}

// ── HISTORIAL DE CONVERSACIONES ────────────
let _hiloNumeroActual = null;

async function cargarConversaciones() {
    const rows = await api('/conversaciones');
    const lista = document.getElementById('listaConversaciones');
    const badge = document.getElementById('convBadge');
    if (!lista) return;

    if (!badge) return;
    badge.textContent = `${rows?.length || 0} contactos`;

    if (!rows?.length) {
        lista.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Sin conversaciones aún</p>';
        return;
    }

    lista.innerHTML = rows.map(r => {
        const hora  = new Date(r.ultima_fecha).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
        const icono = r.ultimo_origen === 'bot' ? '🤖' : '👤';
        const badge = r.estado === 'humano' ? '<span class="conv-humano">humano</span>' : '';
        const nombreSeguro = (r.nombre || r.numero).replace(/'/g, "\\'");
        return `<div class="conv-item" onclick="verHilo('${r.numero}','${nombreSeguro}')">
            <div class="conv-avatar">${r.nombre?.[0]?.toUpperCase() || '?'}</div>
            <div class="conv-info">
                <div class="conv-name">${r.nombre || r.numero}${badge}</div>
                <div class="conv-preview">${icono} ${r.ultimo_mensaje}</div>
            </div>
            <div class="conv-time">${hora}</div>
        </div>`;
    }).join('');
}

function formatearWA(numero) {
    if (!numero || !/^\d+$/.test(numero)) return null; // no es número real
    if (/^591\d{8}$/.test(numero)) return `+591 ${numero.slice(3)}`; // Bolivia
    if (numero.length >= 10) return `+${numero}`;
    return numero;
}

async function verHilo(numero, nombre) {
    _hiloNumeroActual = numero;
    document.getElementById('hiloTitulo').textContent = nombre;
    const hiloNum = document.getElementById('hiloNumero');
    const waFmt = formatearWA(numero);
    if (hiloNum) hiloNum.textContent = waFmt ? `📱 ${waFmt}` : '';
    document.getElementById('hiloBorrarBtn').dataset.numero = numero;

    const msgs = await api(`/conversaciones/${numero}`);
    const cont  = document.getElementById('hiloMensajes');

    cont.innerHTML = msgs.map(m => {
        const tipo = m.origen === 'bot' ? 'bot' : 'cliente';
        const hora = new Date(m.fecha).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
        return `<div class="msg-wrap ${tipo}">
            <div class="msg-bubble ${tipo}">${m.mensaje}</div>
            <span class="msg-meta">${tipo === 'bot' ? '🤖 Bot' : '👤 Cliente'} · ${hora}</span>
        </div>`;
    }).join('');

    cont.scrollTop = cont.scrollHeight;
    abrirModal('modalHilo');
}

async function borrarHilo() {
    const numero = _hiloNumeroActual;
    if (!numero || !confirm('¿Borrar el historial de esta conversación?')) return;
    await api(`/conversaciones/${numero}`, 'DELETE');
    cerrarModal('modalHilo');
    cargarConversaciones();
}

// ── CONFIGURACIÓN ─────────────────────────
async function cargarConfig() {
    await cargarNombreEmpresa();
}

async function guardarConfig() {
    const data = {
        nombre_empresa: document.getElementById('cfgNombreEmpresa').value.trim(),
        nombre_bot:     document.getElementById('cfgNombreBot').value.trim(),
        moneda:         document.getElementById('cfgMoneda').value,
        tipo_cambio:    document.getElementById('cfgTipoCambio').value.trim(),
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
async function cargarPagosView() {
    const pagos = await api('/pagos');
    renderPagos(pagos);
}

function renderPagos(pagos) {
    const grid = document.getElementById('listaPagos');
    if (!grid) return;
    if (!pagos?.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="ei">💳</span><p>Sin métodos configurados — agrega uno para que el bot pueda cobrar</p></div>`;
        return;
    }
    grid.innerHTML = pagos.map(p => `
        <div class="glass-panel pago-card">
            <button class="delete-btn" onclick="eliminarPago(${p.id})">✕</button>
            <span class="pago-tipo">${tipoLabel(p.tipo)}</span>
            <h3>${p.nombre}</h3>
            <p class="pago-detalle">${p.detalle || ''}</p>
            ${p.imagen
                ? `<img src="/img/qr/${p.imagen}" class="qr-preview" alt="QR">`
                : '<p style="color:var(--text-muted);font-size:12px;margin-top:8px">Sin imagen QR</p>'}
        </div>`
    ).join('');
}

async function guardarPago() {
    const data = {
        nombre:  document.getElementById('pagoNombre').value.trim(),
        tipo:    document.getElementById('pagoTipo').value,
        detalle: document.getElementById('pagoDetalle').value.trim()
    };
    if (!data.nombre) return mostrarToast('El nombre es obligatorio', 'error');

    const input = document.getElementById('pagoQRInput');
    if (input.files[0]) {
        const form = new FormData();
        form.append('file', input.files[0]);
        const up  = await fetch('/api/media/upload?carpeta=qr', { method: 'POST', body: form });
        const upd = await up.json();
        if (upd.filename) data.imagen = upd.filename;
    }

    await api('/pagos', 'POST', data);
    cerrarModal('modalPago');
    mostrarToast('✅ Método de pago guardado');
    cargarPagosView();
    // Actualizar contador en bot-view si está cargado
    const metodos = await api('/pagos');
    if (document.getElementById('botMetodos')) document.getElementById('botMetodos').textContent = metodos.length;
    if (document.getElementById('botMetodosResumen')) document.getElementById('botMetodosResumen').textContent = metodos.length;
}

async function eliminarPago(id) {
    if (!confirm('¿Eliminar este método de pago?')) return;
    await api(`/pagos/${id}`, 'DELETE');
    mostrarToast('Método eliminado');
    cargarPagosView();
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
