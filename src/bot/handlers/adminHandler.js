// =============================================
// HANDLER DE ADMINS — Panel por WhatsApp
// =============================================

const sesiones = {};

function getSesion(numero) {
    return sesiones[numero] || null;
}
function setSesion(numero, data) {
    sesiones[numero] = { ...sesiones[numero], ...data };
}
function resetSesion(numero) {
    delete sesiones[numero];
}

function getConfig(db, clave, def = '') {
    return db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave)?.valor || def;
}

// ── MENÚS ─────────────────────────────────────────────────────────────────
function menuPrincipal(admin) {
    return `👑 *PANEL ADMIN*\nHola, *${admin.usuario}* 👋\n\n` +
        `*1* — 📋 Pedidos pendientes\n` +
        `*2* — 📦 Stock disponible\n` +
        `*3* — 💰 Ventas de hoy\n` +
        `*4* — 👥 Últimos clientes\n` +
        `*5* — 📊 Resumen general\n` +
        `*0* — ❌ Salir del panel\n\n` +
        `_Para más opciones usa el panel web_ 🌐`;
}

// ── RESPUESTAS ─────────────────────────────────────────────────────────────
function verPedidosPendientes(db) {
    const pedidos = db.prepare(`
        SELECT p.id, c.nombre, c.whatsapp, s.nombre as servicio,
               p.metodo_pago, p.creado_en, p.notas
        FROM pedidos p
        LEFT JOIN clientes c ON c.id = p.cliente_id
        LEFT JOIN servicios s ON s.id = p.servicio_id
        WHERE p.estado = 'pendiente'
        ORDER BY p.creado_en DESC
        LIMIT 10
    `).all();

    if (!pedidos.length) return '✅ No hay pedidos pendientes en este momento.';

    const lineas = pedidos.map(p => {
        const nombre = p.nombre || p.whatsapp;
        const fecha  = new Date(p.creado_en).toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' });
        return `*#${p.id}* — ${nombre}\n   🎬 ${p.servicio || '?'} | 💳 ${p.metodo_pago || '?'}\n   📅 ${fecha}${p.notas ? '\n   📝 ' + p.notas.substring(0, 60) : ''}`;
    });

    return `📋 *PEDIDOS PENDIENTES (${pedidos.length})*\n\n${lineas.join('\n\n')}\n\n` +
        `_Responde con *atender #ID* para marcar uno como atendido_\n` +
        `_Ej: atender #5_`;
}

function verStock(db) {
    const servicios = db.prepare(`
        SELECT s.nombre,
               COUNT(CASE WHEN p.estado = 'libre' THEN 1 END) as libres,
               COUNT(CASE WHEN p.estado = 'vendido' THEN 1 END) as vendidos
        FROM servicios s
        LEFT JOIN cuentas c ON c.servicio_id = s.id AND c.activa = 1
        LEFT JOIN perfiles p ON p.cuenta_id = c.id
        WHERE s.activo = 1
        GROUP BY s.id
    `).all();

    if (!servicios.length) return '📦 No hay servicios configurados.';

    const lineas = servicios.map(s => {
        const icono = s.libres === 0 ? '🔴' : s.libres <= 2 ? '🟡' : '🟢';
        return `${icono} *${s.nombre}* — ${s.libres} libre${s.libres !== 1 ? 's' : ''} / ${s.vendidos} vendido${s.vendidos !== 1 ? 's' : ''}`;
    });

    return `📦 *STOCK DISPONIBLE*\n\n${lineas.join('\n')}`;
}

function verVentasHoy(db) {
    const moneda = getConfig(db, 'moneda', 'Bs');
    const tc     = parseFloat(getConfig(db, 'tipo_cambio', '6.96'));

    const ventas = db.prepare(`
        SELECT v.id, v.precio, s.nombre as servicio, c.nombre as cliente, c.whatsapp, v.fecha
        FROM ventas v
        LEFT JOIN perfiles pf ON pf.id = v.perfil_id
        LEFT JOIN cuentas ct ON ct.id = pf.cuenta_id
        LEFT JOIN servicios s ON s.id = ct.servicio_id
        LEFT JOIN pedidos pd ON pd.id = v.pedido_id
        LEFT JOIN clientes c ON c.id = pd.cliente_id
        WHERE date(v.fecha) = date('now')
        ORDER BY v.fecha DESC
    `).all();

    if (!ventas.length) return '💰 No hay ventas registradas hoy.';

    const total = ventas.reduce((sum, v) => sum + (v.precio || 0), 0);
    const lineas = ventas.map(v => {
        const bs = (v.precio * tc).toFixed(2);
        return `• ${v.servicio || '?'} — *$${v.precio?.toFixed(2)} / Bs ${bs}* (${v.cliente || v.whatsapp || '?'})`;
    });

    return `💰 *VENTAS DE HOY (${ventas.length})*\n\n${lineas.join('\n')}\n\n` +
        `*Total: $${total.toFixed(2)} / Bs ${(total * tc).toFixed(2)}*`;
}

function verUltimosClientes(db) {
    const clientes = db.prepare(`
        SELECT nombre, whatsapp, puntos, total_compras, registrado_en
        FROM clientes
        ORDER BY registrado_en DESC
        LIMIT 8
    `).all();

    if (!clientes.length) return '👥 No hay clientes registrados aún.';

    const lineas = clientes.map(c => {
        const nombre = c.nombre || 'Sin nombre';
        return `• *${nombre}* — ${c.whatsapp}\n  ⭐ ${c.puntos} pts | 🛒 ${c.total_compras} compras`;
    });

    return `👥 *ÚLTIMOS CLIENTES*\n\n${lineas.join('\n\n')}`;
}

function verResumen(db) {
    const tc = parseFloat(getConfig(db, 'moneda', '6.96'));

    const pendientes  = db.prepare("SELECT COUNT(*) as n FROM pedidos WHERE estado = 'pendiente'").get()?.n || 0;
    const totalClientes = db.prepare("SELECT COUNT(*) as n FROM clientes").get()?.n || 0;
    const perfilesLibres = db.prepare("SELECT COUNT(*) as n FROM perfiles WHERE estado = 'libre'").get()?.n || 0;
    const ventasHoy  = db.prepare("SELECT SUM(precio) as t FROM ventas WHERE date(fecha) = date('now')").get()?.t || 0;
    const ventasMes  = db.prepare("SELECT SUM(precio) as t FROM ventas WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')").get()?.t || 0;

    return `📊 *RESUMEN GENERAL*\n\n` +
        `🛒 Pedidos pendientes: *${pendientes}*\n` +
        `👥 Clientes totales: *${totalClientes}*\n` +
        `📦 Perfiles libres: *${perfilesLibres}*\n` +
        `💰 Ventas hoy: *$${ventasHoy.toFixed(2)}*\n` +
        `📅 Ventas este mes: *$${ventasMes.toFixed(2)}*`;
}

// ── HANDLER PRINCIPAL ──────────────────────────────────────────────────────
async function manejar({ sock, jid, texto, numero, nombre, adminRow, db }) {
    const cmd = texto.toLowerCase().trim();

    // Activar panel
    if (['panel', 'admin', '/panel', '/admin', 'menu', '/menu'].includes(cmd)) {
        setSesion(numero, { activo: true });
        return enviar(sock, jid, menuPrincipal(adminRow));
    }

    // Comando rápido: atender pedido desde cualquier estado
    const matchAtender = texto.match(/^atender\s+#?(\d+)$/i);
    if (matchAtender) {
        const pedidoId = parseInt(matchAtender[1]);
        const pedido = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(pedidoId);
        if (!pedido) return enviar(sock, jid, `❌ Pedido #${pedidoId} no encontrado.`);
        if (pedido.estado !== 'pendiente') return enviar(sock, jid, `⚠️ El pedido #${pedidoId} ya está ${pedido.estado}.`);

        db.prepare("UPDATE pedidos SET estado = 'atendido', atendido_por = ?, atendido_en = datetime('now') WHERE id = ?")
          .run(adminRow.id, pedidoId);
        return enviar(sock, jid, `✅ Pedido #${pedidoId} marcado como *atendido*.`);
    }

    // Si no está en panel activo, ignorar mensajes normales
    const sesion = getSesion(numero);
    if (!sesion?.activo) return;

    // Menú del panel
    switch (cmd) {
        case '1': return enviar(sock, jid, verPedidosPendientes(db));
        case '2': return enviar(sock, jid, verStock(db));
        case '3': return enviar(sock, jid, verVentasHoy(db));
        case '4': return enviar(sock, jid, verUltimosClientes(db));
        case '5': return enviar(sock, jid, verResumen(db));
        case '0':
            resetSesion(numero);
            return enviar(sock, jid, '👋 Saliste del panel. Escribe *panel* para volver.');
        default:
            return enviar(sock, jid,
                '❓ Opción no reconocida. Escribe el *número* de la opción:\n\n' + menuPrincipal(adminRow)
            );
    }
}

function enviar(sock, jid, texto) {
    return sock.sendMessage(jid, { text: texto });
}

module.exports = { manejar };
