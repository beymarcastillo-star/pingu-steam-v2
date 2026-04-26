// =============================================
// HANDLER DE ADMINS — Flujo numérico
// =============================================
const path      = require('path');
const fs        = require('fs');
const { chatAdmin } = require('../../services/aiService');

// Sesiones de admin: estado + contexto
const sesiones = {};

// Pedidos pendientes de respuesta (notificación recibida)
const pendingNotifications = {}; // { telefono: pedidoId }

function getSesion(numero) { return sesiones[numero] || {}; }
function setSesion(numero, data) { sesiones[numero] = { ...sesiones[numero], ...data }; }
function resetSesion(numero)     { delete sesiones[numero]; }

function setPendingNotification(telefono, pedidoId) {
    pendingNotifications[telefono] = pedidoId;
}

function getConfig(db, clave, def = '') {
    return require('../../db/database').getConfig(clave, def);
}

function enviar(sock, jid, texto) {
    return sock.sendMessage(jid, { text: texto });
}

// ── MENÚ PRINCIPAL ────────────────────────────────────────────────────────
function msgMenuPrincipal(admin) {
    return `👑 *PANEL ADMIN*\nHola, *${admin.usuario}* 👋\n\n` +
        `*1* — 🛒 Pedidos pendientes\n` +
        `*2* — 📦 Stock disponible\n` +
        `*3* — 💰 Ventas de hoy\n` +
        `*4* — 👥 Últimos clientes\n` +
        `*5* — 📊 Resumen general\n` +
        `*6* — ➕ Agregar cuenta\n` +
        `*0* — ❌ Salir del panel\n\n` +
        `💬 _También puedes escribir en lenguaje natural_`;
}

// ── CONSULTAS ─────────────────────────────────────────────────────────────
function verPedidosPendientes(db) {
    return db.prepare(`
        SELECT p.*, c.nombre as cliente_nombre, c.whatsapp,
               s.nombre as servicio_nombre
        FROM pedidos p
        LEFT JOIN clientes c  ON c.id = p.cliente_id
        LEFT JOIN servicios s ON s.id = p.servicio_id
        WHERE p.estado = 'pendiente'
        ORDER BY p.creado_en DESC
        LIMIT 10
    `).all();
}

function msgPedido(p, idx, total) {
    const fecha = new Date(p.creado_en).toLocaleString('es-BO',
        { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' });
    const aiData = p.ai_analisis ? (() => { try { return JSON.parse(p.ai_analisis); } catch { return null; } })() : null;
    const aiLinea = aiData
        ? `🤖 IA: ${aiData.banco || '?'} · Bs ${aiData.monto ?? '?'} ${aiData.coincide ? '✅' : '⚠️'}\n`
        : '';

    return `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🛒 Pedido ${idx + 1} de ${total} — *#${p.id}*\n` +
        `👤 ${p.cliente_nombre || p.whatsapp}\n` +
        `🎬 ${p.servicio_nombre || '?'}\n` +
        `💳 ${p.metodo_pago || '?'}\n` +
        `📅 ${fecha}\n` +
        (p.notas ? `📝 ${p.notas.substring(0, 80)}\n` : '') +
        aiLinea +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*1* — Tomar este pedido\n` +
        `*2* — Ver siguiente\n` +
        `*3* — Volver al menú`;
}

function verStock(db) {
    const rows = db.prepare(`
        SELECT s.nombre,
               COUNT(CASE WHEN p.estado = 'libre'   THEN 1 END) as libres,
               COUNT(CASE WHEN p.estado = 'vendido' THEN 1 END) as vendidos
        FROM servicios s
        LEFT JOIN cuentas  c ON c.servicio_id = s.id AND c.activa = 1
        LEFT JOIN perfiles p ON p.cuenta_id = c.id
        WHERE s.activo = 1
        GROUP BY s.id
    `).all();
    if (!rows.length) return '📦 No hay servicios configurados.';
    const lineas = rows.map(s => {
        const icono = s.libres === 0 ? '🔴' : s.libres <= 2 ? '🟡' : '🟢';
        return `${icono} *${s.nombre}* — ${s.libres} libre${s.libres !== 1 ? 's' : ''} / ${s.vendidos} vendido${s.vendidos !== 1 ? 's' : ''}`;
    });
    return `📦 *STOCK DISPONIBLE*\n\n${lineas.join('\n')}\n\n*0* — Menú`;
}

function verVentasHoy(db) {
    const tc = parseFloat(getConfig(db, 'tipo_cambio', '6.96'));
    const ventas = db.prepare(`
        SELECT v.precio, s.nombre as servicio, c.nombre as cliente, c.whatsapp
        FROM ventas v
        LEFT JOIN perfiles  pf ON pf.id = v.perfil_id
        LEFT JOIN cuentas   ct ON ct.id = pf.cuenta_id
        LEFT JOIN servicios s  ON s.id  = ct.servicio_id
        LEFT JOIN pedidos   pd ON pd.id = v.pedido_id
        LEFT JOIN clientes  c  ON c.id  = pd.cliente_id
        WHERE date(v.fecha) = date('now')
        ORDER BY v.fecha DESC
    `).all();
    if (!ventas.length) return '💰 No hay ventas registradas hoy.\n\n*0* — Menú';
    const total  = ventas.reduce((s, v) => s + (v.precio || 0), 0);
    const lineas = ventas.map(v =>
        `• ${v.servicio || '?'} — *Bs ${(v.precio * tc).toFixed(2)}* (${v.cliente || v.whatsapp || '?'})`
    );
    return `💰 *VENTAS DE HOY (${ventas.length})*\n\n${lineas.join('\n')}\n\n*Total: Bs ${(total * tc).toFixed(2)}*\n\n*0* — Menú`;
}

function verUltimosClientes(db) {
    const clientes = db.prepare(`
        SELECT nombre, whatsapp, puntos, total_compras
        FROM clientes ORDER BY registrado_en DESC LIMIT 8
    `).all();
    if (!clientes.length) return '👥 No hay clientes aún.\n\n*0* — Menú';
    const lineas = clientes.map(c =>
        `• *${c.nombre || 'Sin nombre'}* — ${c.whatsapp}\n  ⭐ ${c.puntos} pts | 🛒 ${c.total_compras} compras`
    );
    return `👥 *ÚLTIMOS CLIENTES*\n\n${lineas.join('\n\n')}\n\n*0* — Menú`;
}

function verResumen(db) {
    const tc          = parseFloat(getConfig(db, 'tipo_cambio', '6.96'));
    const pendientes  = db.prepare("SELECT COUNT(*) as n FROM pedidos WHERE estado = 'pendiente'").get()?.n || 0;
    const totalCli    = db.prepare("SELECT COUNT(*) as n FROM clientes").get()?.n || 0;
    const libres      = db.prepare("SELECT COUNT(*) as n FROM perfiles WHERE estado = 'libre'").get()?.n || 0;
    const ventasHoy   = db.prepare("SELECT SUM(precio) as t FROM ventas WHERE date(fecha) = date('now')").get()?.t || 0;
    const ventasMes   = db.prepare("SELECT SUM(precio) as t FROM ventas WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')").get()?.t || 0;
    return `📊 *RESUMEN GENERAL*\n\n` +
        `🛒 Pedidos pendientes: *${pendientes}*\n` +
        `👥 Clientes: *${totalCli}*\n` +
        `📦 Perfiles libres: *${libres}*\n` +
        `💰 Ventas hoy: *Bs ${(ventasHoy * tc).toFixed(2)}*\n` +
        `📅 Ventas mes: *Bs ${(ventasMes * tc).toFixed(2)}*\n\n` +
        `*0* — Menú`;
}

// ── APROBAR PEDIDO: entregar credenciales ─────────────────────────────────
async function aprobarPedido(sock, jid, pedidoId, adminRow, db) {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    if (!pedido) return enviar(sock, jid, `❌ Pedido #${pedidoId} no encontrado.`);
    if (pedido.estado === 'atendido') return enviar(sock, jid, `⚠️ El pedido #${pedidoId} ya fue aprobado.`);

    // Buscar perfil libre del servicio
    const perfil = db.prepare(`
        SELECT pf.*, c.correo, c.contrasena
        FROM perfiles pf
        JOIN cuentas c ON c.id = pf.cuenta_id
        WHERE c.servicio_id = ? AND c.activa = 1 AND pf.estado = 'libre'
        ORDER BY pf.id ASC LIMIT 1
    `).get(pedido.servicio_id);

    if (!perfil) {
        await enviar(sock, jid, `⚠️ No hay perfiles libres para el servicio del pedido #${pedidoId}.\nAgrega stock antes de aprobar.`);
        return;
    }

    const cliente  = db.prepare('SELECT * FROM clientes WHERE id = ?').get(pedido.cliente_id);
    const servicio = db.prepare('SELECT nombre FROM servicios WHERE id = ?').get(pedido.servicio_id);
    const tc       = parseFloat(getConfig(db, 'tipo_cambio', '6.96'));

    // Calcular fecha de vencimiento (+30 días)
    const vence = new Date();
    vence.setDate(vence.getDate() + 30);
    const venceStr = vence.toISOString().slice(0, 10);
    const venceFmt = vence.toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' });

    // Precio en Bs (desde notas del pedido o precio del perfil)
    const precioBs = perfil.precio_venta || 0;

    db.transaction(() => {
        // Marcar perfil como vendido
        db.prepare(`
            UPDATE perfiles SET estado = 'vendido', cliente_id = ?,
            fecha_vencimiento = ?, vendido_en = datetime('now') WHERE id = ?
        `).run(cliente.id, venceStr, perfil.id);

        // Registrar venta
        db.prepare('INSERT INTO ventas (pedido_id, perfil_id, precio) VALUES (?, ?, ?)')
            .run(pedidoId, perfil.id, precioBs / tc); // precio en USD para la tabla

        // Marcar pedido como atendido
        db.prepare(`
            UPDATE pedidos SET estado = 'atendido', atendido_por = ?,
            atendido_en = datetime('now') WHERE id = ?
        `).run(adminRow.id, pedidoId);

        // Sumar puntos y total_compras al cliente
        const umbralAlto  = parseInt(getConfig(db, 'puntos_umbral_alto',  '200'));
        const umbralMedio = parseInt(getConfig(db, 'puntos_umbral_medio', '100'));
        const umbralBajo  = parseInt(getConfig(db, 'puntos_umbral_bajo',  '50'));
        const ptsAlto     = parseInt(getConfig(db, 'puntos_por_compra_alta',  '30'));
        const ptsMedio    = parseInt(getConfig(db, 'puntos_por_compra_media', '15'));
        const ptsBajo     = parseInt(getConfig(db, 'puntos_por_compra_baja',  '5'));
        let puntos = ptsBajo;
        if (precioBs >= umbralAlto)       puntos = ptsAlto;
        else if (precioBs >= umbralMedio) puntos = ptsMedio;
        else if (precioBs >= umbralBajo)  puntos = ptsBajo;

        db.prepare('UPDATE clientes SET puntos = puntos + ?, total_compras = total_compras + 1 WHERE id = ?')
            .run(puntos, cliente.id);
        db.prepare(`INSERT INTO puntos_historial (cliente_id, tipo, cantidad, motivo)
                    VALUES (?, 'ganado', ?, 'Compra aprobada #${pedidoId}')`)
            .run(cliente.id, puntos);
    })();

    // Confirmar al admin
    await enviar(sock, jid,
        `✅ *Pedido #${pedidoId} aprobado*\n` +
        `Credenciales enviadas a ${cliente?.nombre || cliente?.whatsapp}.`
    );

    // Enviar credenciales al cliente
    if (cliente?.whatsapp) {
        const clienteJid = `${cliente.whatsapp}@s.whatsapp.net`;
        let credMsg =
            `✅ *¡Tu pago fue aprobado!* 🎉\n\n` +
            `*${servicio?.nombre || 'Servicio'}*\n\n` +
            `📧 *Correo:* ${perfil.correo}\n` +
            `🔑 *Contraseña:* ${perfil.contrasena}\n` +
            `👤 *Perfil:* ${perfil.nombre_perfil}\n`;
        if (perfil.pin) credMsg += `🔢 *PIN:* ${perfil.pin}\n`;
        credMsg +=
            `\n📅 *Válido hasta:* ${venceFmt}\n\n` +
            `¡Disfruta tu servicio! 😊\n` +
            `Escribe *menu* si necesitas algo más.`;

        await sock.sendMessage(clienteJid, { text: credMsg }).catch(() => {});
    }
}

// ── RECHAZAR PEDIDO ───────────────────────────────────────────────────────
async function rechazarPedido(sock, jid, pedidoId, motivo, adminRow, db) {
    const pedido  = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    const cliente = pedido ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(pedido.cliente_id) : null;

    db.prepare("UPDATE pedidos SET estado = 'cancelado', atendido_por = ?, atendido_en = datetime('now') WHERE id = ?")
        .run(adminRow.id, pedidoId);

    await enviar(sock, jid, `✅ Pedido #${pedidoId} rechazado.`);

    if (cliente?.whatsapp) {
        const clienteJid = `${cliente.whatsapp}@s.whatsapp.net`;
        await sock.sendMessage(clienteJid, {
            text: `❌ Tu comprobante del pedido *#${pedidoId}* no fue aprobado.\n` +
                  `📋 Motivo: *${motivo}*\n\n` +
                  `Por favor verifica e intenta de nuevo, o escribe *menu* para volver al inicio.`
        }).catch(() => {});
    }
}

// ── CONTEXTO PARA IA ─────────────────────────────────────────────────────
function construirContexto(db) {
    const tc = parseFloat(require('../../db/database').getConfig('tipo_cambio', '6.96'));

    const pendientes = db.prepare("SELECT COUNT(*) as n FROM pedidos WHERE estado = 'pendiente'").get()?.n || 0;
    const tomados    = db.prepare("SELECT COUNT(*) as n FROM pedidos WHERE estado = 'tomado'").get()?.n || 0;
    const totalCli   = db.prepare("SELECT COUNT(*) as n FROM clientes").get()?.n || 0;
    const ventasHoy  = db.prepare("SELECT COUNT(*) as n, COALESCE(SUM(precio),0) as t FROM ventas WHERE date(fecha) = date('now')").get() || { n: 0, t: 0 };
    const ventasMes  = db.prepare("SELECT COUNT(*) as n, COALESCE(SUM(precio),0) as t FROM ventas WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')").get() || { n: 0, t: 0 };

    const stock = db.prepare(`
        SELECT s.nombre,
               COUNT(CASE WHEN p.estado = 'libre'   THEN 1 END) as libres,
               COUNT(CASE WHEN p.estado = 'vendido' THEN 1 END) as vendidos
        FROM servicios s
        LEFT JOIN cuentas  c ON c.servicio_id = s.id AND c.activa = 1
        LEFT JOIN perfiles p ON p.cuenta_id = c.id
        WHERE s.activo = 1
        GROUP BY s.id
    `).all();
    const stockTexto = stock.map(s => `  - ${s.nombre}: ${s.libres} libres, ${s.vendidos} vendidos`).join('\n');

    const ultimosClientes = db.prepare(
        "SELECT nombre, whatsapp, total_compras FROM clientes ORDER BY registrado_en DESC LIMIT 5"
    ).all();
    const clientesTexto = ultimosClientes.map(c =>
        `  - ${c.nombre || c.whatsapp} (${c.total_compras} compras)`
    ).join('\n');

    return (
        `Fecha/hora actual: ${new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}\n` +
        `Pedidos pendientes: ${pendientes}\n` +
        `Pedidos en proceso (tomados): ${tomados}\n` +
        `Clientes registrados: ${totalCli}\n` +
        `Ventas hoy: ${ventasHoy.n} ventas — Bs ${(ventasHoy.t * tc).toFixed(2)}\n` +
        `Ventas este mes: ${ventasMes.n} ventas — Bs ${(ventasMes.t * tc).toFixed(2)}\n` +
        `Stock por servicio:\n${stockTexto || '  Sin servicios configurados'}\n` +
        `Últimos clientes:\n${clientesTexto || '  Sin clientes aún'}`
    );
}

// ── FLUJO AGREGAR CUENTA ──────────────────────────────────────────────────
function msgInicioAgregarCuenta(db) {
    const servicios = db.prepare('SELECT id, nombre FROM servicios WHERE activo = 1').all();
    if (!servicios.length) return { msg: '❌ No hay servicios activos. Crea uno desde el panel web primero.\n\n*0* — Menú', servicios: [] };
    const lista = servicios.map((s, i) => `*${i + 1}* — ${s.nombre}`).join('\n');
    return { msg: `➕ *AGREGAR CUENTA*\n\n¿A qué servicio pertenece?\n\n${lista}\n\n*0* — Cancelar`, servicios };
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────
async function manejar({ sock, jid, texto, numero, nombre, adminRow, db, msg }) {
    const cmd    = texto.trim();
    const cmdLow = cmd.toLowerCase();
    const sesion = getSesion(numero);

    // ── Activar panel ──────────────────────────────────────────────────────
    if (['panel', 'admin', '/panel', '/admin', 'menu', '/menu'].includes(cmdLow)) {
        setSesion(numero, { activo: true, estado: 'menu' });
        return enviar(sock, jid, msgMenuPrincipal(adminRow));
    }

    // ── Respuesta a notificación de comprobante (1 = tomar, 2 = ignorar) ──
    const pedidoPendiente = pendingNotifications[numero];
    if (pedidoPendiente && (cmd === '1' || cmd === '2')) {
        delete pendingNotifications[numero];

        if (cmd === '2') return; // ignorar silenciosamente

        // cmd === '1': tomar el pedido
        const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoPendiente);
        if (!pedido) return enviar(sock, jid, `❌ Pedido #${pedidoPendiente} ya no existe.`);
        if (pedido.estado !== 'pendiente') {
            return enviar(sock, jid, `ℹ️ El pedido *#${pedidoPendiente}* ya fue tomado por otro asesor.`);
        }

        // Marcar como tomado
        db.prepare(`UPDATE pedidos SET estado = 'tomado', tomado_por = ?, tomado_en = datetime('now') WHERE id = ?`)
            .run(adminRow.id, pedidoPendiente);

        setSesion(numero, { activo: true, estado: 'revisando_pedido', pedidoId: pedidoPendiente });

        // Notificar a los otros admins
        const otrosAdmins = db.prepare("SELECT telefono FROM admins WHERE activo = 1 AND telefono != ?").all(numero);
        for (const adm of otrosAdmins) {
            const otroJid = `${adm.telefono}@s.whatsapp.net`;
            sock.sendMessage(otroJid, { text: `ℹ️ El pedido *#${pedidoPendiente}* fue tomado por *${adminRow.usuario}*.` }).catch(() => {});
        }

        return enviar(sock, jid,
            `✅ Pedido *#${pedidoPendiente}* es tuyo, *${adminRow.usuario}*.\n\n` +
            `*1* — Aprobar y enviar credenciales\n` +
            `*2* — Rechazar`
        );
    }

    // ── Si no está en panel activo, ignorar ───────────────────────────────
    if (!sesion?.activo) return;

    // ── Estado: revisando un pedido (aprobar/rechazar) ────────────────────
    if (sesion.estado === 'revisando_pedido') {
        if (cmd === '1') {
            await aprobarPedido(sock, jid, sesion.pedidoId, adminRow, db);
            setSesion(numero, { estado: 'menu' });
            return enviar(sock, jid, msgMenuPrincipal(adminRow));
        }
        if (cmd === '2') {
            setSesion(numero, { estado: 'esperando_motivo_rechazo' });
            return enviar(sock, jid,
                `¿Motivo del rechazo?\n\n` +
                `*1* — Monto incorrecto\n` +
                `*2* — Imagen no válida\n` +
                `*3* — Comprobante duplicado\n` +
                `*4* — Otro motivo (escríbelo)`
            );
        }
        return enviar(sock, jid, `*1* — Aprobar\n*2* — Rechazar`);
    }

    // ── Estado: esperando motivo de rechazo ───────────────────────────────
    if (sesion.estado === 'esperando_motivo_rechazo') {
        const motivos = {
            '1': 'Monto incorrecto',
            '2': 'Imagen no válida',
            '3': 'Comprobante duplicado',
        };
        const motivo = motivos[cmd] || cmd;
        await rechazarPedido(sock, jid, sesion.pedidoId, motivo, adminRow, db);
        setSesion(numero, { estado: 'menu' });
        return enviar(sock, jid, msgMenuPrincipal(adminRow));
    }

    // ── Estado: viendo lista de pedidos ───────────────────────────────────
    if (sesion.estado === 'viendo_pedidos') {
        const pedidos = sesion.pedidosLista || [];
        const idx     = sesion.pedidosIdx   || 0;

        if (cmd === '1' && pedidos[idx]) {
            const p = pedidos[idx];
            // Verificar que siga pendiente
            const actual = db.prepare('SELECT estado FROM pedidos WHERE id = ?').get(p.id);
            if (actual?.estado !== 'pendiente') {
                setSesion(numero, { pedidosIdx: idx + 1 });
                const sig = pedidos[idx + 1];
                if (!sig) {
                    setSesion(numero, { estado: 'menu' });
                    return enviar(sock, jid, `ℹ️ No hay más pedidos pendientes.\n\n${msgMenuPrincipal(adminRow)}`);
                }
                return enviar(sock, jid, msgPedido(sig, idx + 1, pedidos.length));
            }

            db.prepare(`UPDATE pedidos SET estado = 'tomado', tomado_por = ?, tomado_en = datetime('now') WHERE id = ?`)
                .run(adminRow.id, p.id);
            setSesion(numero, { estado: 'revisando_pedido', pedidoId: p.id });
            return enviar(sock, jid,
                `✅ Pedido *#${p.id}* es tuyo.\n\n` +
                `*1* — Aprobar y enviar credenciales\n` +
                `*2* — Rechazar`
            );
        }
        if (cmd === '2') {
            const sigIdx = idx + 1;
            if (sigIdx >= pedidos.length) {
                setSesion(numero, { estado: 'menu' });
                return enviar(sock, jid, `✅ No hay más pedidos.\n\n${msgMenuPrincipal(adminRow)}`);
            }
            setSesion(numero, { pedidosIdx: sigIdx });
            return enviar(sock, jid, msgPedido(pedidos[sigIdx], sigIdx, pedidos.length));
        }
        if (cmd === '3' || cmd === '0') {
            setSesion(numero, { estado: 'menu' });
            return enviar(sock, jid, msgMenuPrincipal(adminRow));
        }
        return enviar(sock, jid, msgPedido(pedidos[idx], idx, pedidos.length));
    }

    // ── Estados de agregar cuenta ─────────────────────────────────────────
    if (sesion.estado === 'agregando_servicio') {
        if (cmd === '0') { setSesion(numero, { estado: 'menu' }); return enviar(sock, jid, msgMenuPrincipal(adminRow)); }
        const idx = parseInt(cmd) - 1;
        const servicios = sesion.serviciosLista || [];
        if (isNaN(idx) || !servicios[idx]) return enviar(sock, jid, `Elige un número de la lista o *0* para cancelar.`);
        setSesion(numero, { estado: 'agregando_correo', servicioId: servicios[idx].id, servicioNombre: servicios[idx].nombre });
        return enviar(sock, jid,
            `✅ Servicio: *${servicios[idx].nombre}*\n\n` +
            `¿Cuál es el *correo* y *contraseña* de la cuenta?\n` +
            `Escribe: correo | contraseña\n\n` +
            `Ej: cuenta@gmail.com | mipass123\n\n*0* — Cancelar`
        );
    }

    if (sesion.estado === 'agregando_correo') {
        if (cmd === '0') { setSesion(numero, { estado: 'menu' }); return enviar(sock, jid, msgMenuPrincipal(adminRow)); }
        const partes = cmd.split('|').map(p => p.trim());
        if (partes.length < 2 || !partes[0] || !partes[1]) {
            return enviar(sock, jid, `Formato incorrecto.\nEscribe: correo | contraseña\n\nEj: cuenta@gmail.com | mipass123`);
        }
        setSesion(numero, { estado: 'agregando_cantidad', correo: partes[0], contrasena: partes[1] });
        return enviar(sock, jid, `¿Cuántos perfiles tiene esta cuenta?\nEscribe solo el número (ej: 4, 5, 6...)\n\n*0* — Cancelar`);
    }

    if (sesion.estado === 'agregando_cantidad') {
        if (cmd === '0') { setSesion(numero, { estado: 'menu' }); return enviar(sock, jid, msgMenuPrincipal(adminRow)); }
        const cant = parseInt(cmd);
        if (isNaN(cant) || cant < 1 || cant > 20) return enviar(sock, jid, `Escribe un número válido entre 1 y 20.`);
        setSesion(numero, { estado: 'agregando_perfiles', cantidadPerfiles: cant, perfiles: [] });
        return enviar(sock, jid,
            `Ahora los datos de cada perfil, *${cant} en total*, uno por línea:\n` +
            `Nombre | PIN  (si no tiene PIN escribe —)\n\n` +
            `Ej:\nPerfil 1 | 1234\nPerfil 2 | —\n\n*0* — Cancelar`
        );
    }

    if (sesion.estado === 'agregando_perfiles') {
        if (cmd === '0') { setSesion(numero, { estado: 'menu' }); return enviar(sock, jid, msgMenuPrincipal(adminRow)); }
        const lineas  = texto.split('\n').map(l => l.trim()).filter(Boolean);
        const perfiles = lineas.map(l => {
            const [nombre, pin] = l.split('|').map(p => p.trim());
            return { nombre_perfil: nombre, pin: (!pin || pin === '—' || pin === '-') ? null : pin };
        }).filter(p => p.nombre_perfil);

        if (perfiles.length !== sesion.cantidadPerfiles) {
            return enviar(sock, jid,
                `Recibí *${perfiles.length}* perfiles pero esperaba *${sesion.cantidadPerfiles}*.\n` +
                `Por favor envía exactamente ${sesion.cantidadPerfiles} líneas.`
            );
        }
        setSesion(numero, { estado: 'agregando_precio', perfiles });
        return enviar(sock, jid, `¿A qué precio vendes cada perfil? (en Bs)\nEscribe solo el número:\n\n*0* — Cancelar`);
    }

    if (sesion.estado === 'agregando_precio') {
        if (cmd === '0') { setSesion(numero, { estado: 'menu' }); return enviar(sock, jid, msgMenuPrincipal(adminRow)); }
        const precio = parseFloat(cmd.replace(',', '.'));
        if (isNaN(precio) || precio <= 0) return enviar(sock, jid, `Escribe un precio válido en Bs. Ej: 35`);
        const total = (precio * sesion.cantidadPerfiles).toFixed(2);
        setSesion(numero, { estado: 'agregando_confirmar', precioBs: precio });
        const resPerfiles = sesion.perfiles.map(p => `  • ${p.nombre_perfil}${p.pin ? ` | PIN: ${p.pin}` : ' | Sin PIN'}`).join('\n');
        return enviar(sock, jid,
            `✅ *Resumen antes de guardar:*\n\n` +
            `📧 ${sesion.correo}\n` +
            `🔑 ${sesion.contrasena}\n` +
            `🎬 ${sesion.servicioNombre}\n` +
            `👤 ${sesion.cantidadPerfiles} perfiles a Bs ${precio} c/u\n` +
            `${resPerfiles}\n` +
            `💰 Ingreso potencial: Bs ${total}\n\n` +
            `*1* — Confirmar y guardar\n` +
            `*2* — Cancelar`
        );
    }

    if (sesion.estado === 'agregando_confirmar') {
        if (cmd === '2' || cmd === '0') {
            setSesion(numero, { estado: 'menu' });
            return enviar(sock, jid, `❌ Cancelado.\n\n${msgMenuPrincipal(adminRow)}`);
        }
        if (cmd === '1') {
            const cuenta = db.prepare(
                'INSERT INTO cuentas (servicio_id, correo, contrasena, tipo) VALUES (?, ?, ?, ?)'
            ).run(sesion.servicioId, sesion.correo, sesion.contrasena, 'perfil');

            const insertPerfil = db.prepare(
                'INSERT INTO perfiles (cuenta_id, nombre_perfil, pin, precio_venta) VALUES (?, ?, ?, ?)'
            );
            db.transaction(() => {
                for (const p of sesion.perfiles) {
                    insertPerfil.run(cuenta.lastInsertRowid, p.nombre_perfil, p.pin, sesion.precioBs);
                }
            })();

            setSesion(numero, { estado: 'menu' });
            return enviar(sock, jid,
                `✅ *Cuenta guardada* con ${sesion.perfiles.length} perfiles en *${sesion.servicioNombre}*.\n\n` +
                msgMenuPrincipal(adminRow)
            );
        }
        return enviar(sock, jid, `*1* — Confirmar\n*2* — Cancelar`);
    }

    // ── Menú principal (números) ──────────────────────────────────────────
    switch (cmd) {
        case '1': {
            const pedidos = verPedidosPendientes(db);
            if (!pedidos.length) {
                return enviar(sock, jid, `✅ No hay pedidos pendientes.\n\n${msgMenuPrincipal(adminRow)}`);
            }
            setSesion(numero, { estado: 'viendo_pedidos', pedidosLista: pedidos, pedidosIdx: 0 });
            return enviar(sock, jid, msgPedido(pedidos[0], 0, pedidos.length));
        }
        case '2': return enviar(sock, jid, verStock(db));
        case '3': return enviar(sock, jid, verVentasHoy(db));
        case '4': return enviar(sock, jid, verUltimosClientes(db));
        case '5': return enviar(sock, jid, verResumen(db));
        case '6': {
            const { msg: msgServ, servicios } = msgInicioAgregarCuenta(db);
            if (servicios.length) setSesion(numero, { estado: 'agregando_servicio', serviciosLista: servicios });
            return enviar(sock, jid, msgServ);
        }
        case '0':
            resetSesion(numero);
            return enviar(sock, jid, '👋 Saliste del panel. Escribe *panel* para volver.');
        default: {
            // Lenguaje natural → DeepSeek responde con contexto del sistema
            const ctx  = construirContexto(db);
            const resp = await chatAdmin(texto, `admin_${numero}`, ctx);
            return enviar(sock, jid, resp);
        }
    }
}

module.exports = { manejar, setPendingNotification };
