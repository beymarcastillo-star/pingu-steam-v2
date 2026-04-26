// =============================================
// HANDLER DE CLIENTES — Flujo de conversación
// =============================================
const aiService = require('../../services/aiService');
const fs   = require('fs');
const path = require('path');

const IMG_PATH = path.join(__dirname, '../../../public/img');

function logMensaje(db, numero, nombre, mensaje, origen, estado = 'auto') {
    try {
        db.prepare(`INSERT INTO conversaciones (numero, nombre, mensaje, origen, estado)
                    VALUES (?, ?, ?, ?, ?)`).run(numero, nombre, mensaje, origen, estado);
        const { emitirAdmin } = require('../connection'); // lazy: evita circular dep
        emitirAdmin('nueva-conversacion', { numero, nombre, mensaje, origen, estado,
            fecha: new Date().toISOString() });
    } catch (e) { console.error('logMensaje:', e.message); }
}

// Sesiones en memoria: { estado, servicioId, servicioNombre, cantidad, pedidoId, _ts }
const sesiones = {};
const SESSION_TTL = 30 * 60 * 1000; // 30 min

setInterval(() => {
    const now = Date.now();
    for (const num of Object.keys(sesiones)) {
        if (now - (sesiones[num]._ts || 0) > SESSION_TTL) delete sesiones[num];
    }
}, 10 * 60 * 1000).unref();

function getSesion(numero) {
    if (!sesiones[numero]) sesiones[numero] = { estado: 'inicio', _ts: Date.now() };
    return sesiones[numero];
}
function setSesion(numero, data) {
    sesiones[numero] = { ...sesiones[numero], ...data, _ts: Date.now() };
}
function resetSesion(numero) {
    sesiones[numero] = { estado: 'inicio', _ts: Date.now() };
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function getConfig(db, clave, def = '') {
    return require('../../db/database').getConfig(clave, def);
}

function registrarCliente(db, numero, nombre) {
    const existe = db.prepare('SELECT id FROM clientes WHERE whatsapp = ?').get(numero);
    if (!existe) {
        db.prepare('INSERT INTO clientes (whatsapp, nombre) VALUES (?, ?)').run(numero, nombre);
    } else if (nombre && nombre !== 'Cliente') {
        db.prepare('UPDATE clientes SET nombre = COALESCE(nombre, ?) WHERE whatsapp = ?').run(nombre, numero);
    }
    return db.prepare('SELECT * FROM clientes WHERE whatsapp = ?').get(numero);
}

function getServicios(db) {
    const tc = parseFloat(getConfig(db, 'tipo_cambio', '6.96'));
    return db.prepare(`
        SELECT s.*, COUNT(CASE WHEN p.estado = 'libre' THEN 1 END) as libres
        FROM servicios s
        LEFT JOIN cuentas c ON c.servicio_id = s.id AND c.activa = 1
        LEFT JOIN perfiles p ON p.cuenta_id = c.id
        WHERE s.activo = 1
        GROUP BY s.id
    `).all().map(s => ({
        ...s,
        precio_bs: s.precio_usd ? +(s.precio_usd * tc).toFixed(2) : null,
        tc
    }));
}

function getMetodosPago(db) {
    return db.prepare("SELECT * FROM metodos_pago WHERE activo = 1").all();
}

function calcularDescuento(cantidad) {
    if (cantidad >= 4) return { pct: 15, label: '15%' };
    if (cantidad >= 3) return { pct: 10, label: '10%' };
    if (cantidad >= 2) return { pct: 5,  label: '5%'  };
    return { pct: 0, label: null };
}

function calcularDescuentoPuntos(db, pts) {
    const umbralAlto  = parseInt(getConfig(db, 'puntos_umbral_alto',  '200'));
    const umbralMedio = parseInt(getConfig(db, 'puntos_umbral_medio', '100'));
    const umbralBajo  = parseInt(getConfig(db, 'puntos_umbral_bajo',  '50'));
    const descAlto    = parseInt(getConfig(db, 'descuento_puntos_alto',  '35'));
    const descMedio   = parseInt(getConfig(db, 'descuento_puntos_medio', '15'));
    const descBajo    = parseInt(getConfig(db, 'descuento_puntos_bajo',  '5'));

    if (pts >= umbralAlto)  return { pct: descAlto,  umbralUsado: umbralAlto,  umbralBajo };
    if (pts >= umbralMedio) return { pct: descMedio, umbralUsado: umbralMedio, umbralBajo };
    if (pts >= umbralBajo)  return { pct: descBajo,  umbralUsado: umbralBajo,  umbralBajo };
    return { pct: 0, umbralUsado: 0, umbralBajo };
}

function formatearPrecio(usd, bs) {
    if (!usd) return 'precio a consultar';
    return `$${usd.toFixed(2)} USD / Bs ${bs?.toFixed(2) ?? '—'}`;
}

function notificarAdmin(sock, db, texto) {
    const adminNum = process.env.ADMIN_NUMBER;
    if (adminNum && sock) {
        const adminJid = adminNum.includes('@') ? adminNum : `${adminNum}@s.whatsapp.net`;
        sock.sendMessage(adminJid, { text: `📋 *NUEVO PEDIDO*\n${texto}` }).catch(() => {});
    }
}

function sumarPuntos(db, clienteId, monto_bs) {
    const umbralAlto  = parseInt(getConfig(db, 'puntos_umbral_alto',  '200'));
    const umbralMedio = parseInt(getConfig(db, 'puntos_umbral_medio', '100'));
    const umbralBajo  = parseInt(getConfig(db, 'puntos_umbral_bajo',  '50'));
    const ptsAlto     = parseInt(getConfig(db, 'puntos_por_compra_alta',  '30'));
    const ptsMedio    = parseInt(getConfig(db, 'puntos_por_compra_media', '15'));
    const ptsBajo     = parseInt(getConfig(db, 'puntos_por_compra_baja',  '5'));

    let puntos = ptsBajo;
    if (monto_bs >= umbralAlto)  puntos = ptsAlto;
    else if (monto_bs >= umbralMedio) puntos = ptsMedio;
    else if (monto_bs >= umbralBajo)  puntos = ptsBajo;

    db.transaction(() => {
        db.prepare('UPDATE clientes SET puntos = puntos + ?, total_compras = total_compras + 1 WHERE id = ?').run(puntos, clienteId);
        db.prepare(`INSERT INTO puntos_historial (cliente_id, tipo, cantidad, motivo)
                    VALUES (?, 'ganado', ?, 'Compra confirmada')`).run(clienteId, puntos);
    })();
    return puntos;
}

// ── MENSAJES PREDEFINIDOS ────────────────────────────────────────────────
function msgMenu(db, nombre) {
    const bot = getConfig(db, 'nombre_bot', 'PinguBot');
    const emp = getConfig(db, 'nombre_empresa', 'Pingu Steam');
    return `👋 Hola *${nombre}*, soy *${bot}* de *${emp}* 🎬\n\n` +
        `¿En qué te puedo ayudar?\n\n` +
        `*1* — 📺 Ver catálogo\n` +
        `*2* — ⭐ Mis puntos\n` +
        `*3* — 👤 Hablar con un humano\n\n` +
        `O escríbeme lo que necesitas 😊`;
}

function msgCatalogo(servicios) {
    if (!servicios.length) return '😔 Por el momento no tenemos servicios disponibles. ¡Vuelve pronto!';

    const lineas = servicios.map((s, i) => {
        const precio = s.precio_usd
            ? `  💰 ${formatearPrecio(s.precio_usd, s.precio_bs)}`
            : '';
        const stock = s.libres > 0
            ? `  🟢 Disponible`
            : `  🔴 Sin stock`;
        return `*${i + 1}.* ${s.nombre}${precio}\n${stock}`;
    });

    return `🎬 *Nuestro catálogo:*\n\n${lineas.join('\n\n')}\n\n` +
        `Escribe el *número* o el *nombre* del servicio que te interesa 👆`;
}

function msgDetalle(s, cantidad = 1) {
    const { pct, label } = calcularDescuento(cantidad);
    let precioFinal = s.precio_usd;
    let precioFinalBs = s.precio_bs;

    if (pct > 0 && precioFinal) {
        precioFinal   = +(precioFinal   * (1 - pct / 100)).toFixed(2);
        precioFinalBs = +(precioFinalBs * (1 - pct / 100)).toFixed(2);
    }

    let msg = `✨ *${s.nombre}*\n`;
    if (s.descripcion) msg += `${s.descripcion}\n`;
    msg += `\n`;

    if (s.precio_usd) {
        msg += `💵 Precio unitario: ${formatearPrecio(s.precio_usd, s.precio_bs)}\n`;
        if (cantidad > 1) {
            msg += `🛒 Cantidad: *${cantidad}*\n`;
            if (pct > 0) msg += `🎁 Descuento: *${label}* por llevar ${cantidad}\n`;
            msg += `✅ Total: *${formatearPrecio(precioFinal, precioFinalBs)}* c/u\n`;
            msg += `   → *Total general: $${(precioFinal * cantidad).toFixed(2)} / Bs ${(precioFinalBs * cantidad).toFixed(2)}*\n`;
        }
    }

    if (s.libres <= 0) msg += `\n⚠️ _Este servicio está temporalmente sin stock._`;

    return msg;
}

function msgMetodosPago(metodos) {
    if (!metodos.length) return '¿Cómo deseas pagar? (transferencia, QR, efectivo)';
    const lista = metodos.map((m, i) => `*${i + 1}.* ${m.nombre}`).join('\n');
    return `💳 *¿Cómo deseas pagar?*\n\n${lista}\n\nEscribe el *número* del método 👆`;
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────
async function manejar({ sock, jid, texto, numero, nombre, db }) {
    const cliente = registrarCliente(db, numero, nombre);
    const sesion  = getSesion(numero);
    const t       = texto.toLowerCase().trim();

    // Loguear mensaje del cliente
    if (texto) logMensaje(db, numero, nombre, texto, 'cliente',
        sesion.estado === 'humano' ? 'humano' : 'auto');

    // Wrapper que envía y loguea la respuesta del bot
    const responder = async (msg) => {
        await enviar(sock, jid, msg);
        logMensaje(db, numero, nombre, msg, 'bot',
            sesion.estado === 'humano' ? 'humano' : 'auto');
    };

    // ── COMANDOS GLOBALES (funcionan en cualquier estado) ─────────────────
    if (['menu', 'inicio', 'start', '/start'].includes(t)) {
        resetSesion(numero);
        return responder(msgMenu(db, nombre));
    }

    if (['mis puntos', 'puntos', 'mis pts'].includes(t)) {
        const pts = cliente?.puntos || 0;
        const { pct: descuentoPct, umbralBajo } = calcularDescuentoPuntos(db, pts);
        let msg = `⭐ *Tus puntos acumulados: ${pts}*\n\n`;
        if (descuentoPct > 0) {
            msg += `🎁 ¡Tienes un descuento de *${descuentoPct}%* disponible!\nEscribe *canjear* para aplicarlo en tu próxima compra.`;
        } else {
            const falta = umbralBajo - pts;
            msg += `Acumula *${falta > 0 ? falta : 0} puntos más* para obtener tu primer descuento 💪\n\n`;
            msg += `_Ganas puntos en cada compra que realices._`;
        }
        return responder(msg);
    }

    if (['catalogo', 'catálogo', 'ver', 'servicios'].includes(t)) {
        const servicios = getServicios(db);
        setSesion(numero, { estado: 'catalogo', servicios });
        return responder(msgCatalogo(servicios));
    }

    if (t === 'canjear') {
        const pts = cliente?.puntos || 0;
        const { pct, umbralUsado, umbralBajo } = calcularDescuentoPuntos(db, pts);
        if (pct === 0) {
            const falta = umbralBajo - pts;
            return responder(`❌ No tienes suficientes puntos.\nTe faltan *${falta > 0 ? falta : 0}* puntos para tu primer descuento 💪`);
        }
        setSesion(numero, { estado: 'canjear_confirmar', descuentoPct: pct, umbralUsado });
        return responder(
            `⭐ Tienes *${pts} puntos*\n` +
            `🎁 Descuento disponible: *${pct}% off*\n\n` +
            `*1* — Aplicar en mi próxima compra\n` +
            `*2* — Guardar para después`
        );
    }

    // ── ESTADO: INICIO ────────────────────────────────────────────────────
    if (sesion.estado === 'inicio') {
        setSesion(numero, { estado: 'menu' });
        return responder(msgMenu(db, nombre));
    }

    // ── ESTADO: MENU ──────────────────────────────────────────────────────
    if (sesion.estado === 'menu') {
        if (t === '1') {
            const servicios = getServicios(db);
            setSesion(numero, { estado: 'catalogo', servicios });
            return responder(msgCatalogo(servicios));
        }
        if (t === '2') {
            const pts = cliente?.puntos || 0;
            const { pct: descuentoPct, umbralBajo } = calcularDescuentoPuntos(db, pts);
            const msg = descuentoPct > 0
                ? `⭐ Tienes *${pts} puntos*!\n🎁 Tienes un descuento de *${descuentoPct}%* disponible.\nEscribe *canjear* para aplicarlo.`
                : `⭐ Tienes *${pts} puntos*.\nAcumula ${umbralBajo - pts} más para tu primer descuento 💪`;
            setSesion(numero, { estado: 'menu' });
            return responder(msg);
        }
        if (t === '3') {
            notificarAdmin(sock, db, `📞 Cliente *${nombre}* (${numero}) quiere hablar con un humano.`);
            setSesion(numero, { estado: 'humano' });
            return responder('👤 ¡Claro! Ya le avisé a un asesor. En breve te contactamos 😊\n\nEscribe *menu* si deseas volver al menú.');
        }
    }

    // ── ESTADO: CATÁLOGO ─────────────────────────────────────────────────
    if (sesion.estado === 'catalogo') {
        const servicios = sesion.servicios || getServicios(db);
        const idx = parseInt(t) - 1;
        let elegido = (!isNaN(idx) && idx >= 0) ? servicios[idx] : null;
        if (!elegido) elegido = servicios.find(s => s.nombre.toLowerCase().includes(t));

        if (elegido) {
            if (elegido.libres <= 0) {
                notificarAdmin(sock, db, `⚠️ Cliente *${nombre}* (${numero}) pidió *${elegido.nombre}* pero no hay stock.`);
                setSesion(numero, { estado: 'menu' });
                return responder(`😔 Lamentablemente *${elegido.nombre}* no tiene stock ahora mismo.\nTe avisaremos cuando haya disponibilidad 🙏\n\n¿Quieres ver otro servicio? Escribe *catalogo*`);
            }
            setSesion(numero, { estado: 'cantidad', servicioId: elegido.id, servicioNombre: elegido.nombre, servicio: elegido });
            return responder(`${msgDetalle(elegido, 1)}\n\n¿*Cuántas cuentas* deseas? Escribe el número 👇\n_(Lleva 2+ y obtienes descuento 🎁)_`);
        }
    }

    // ── ESTADO: CANTIDAD ──────────────────────────────────────────────────
    if (sesion.estado === 'cantidad') {
        const cant = parseInt(t);
        if (!isNaN(cant) && cant >= 1 && cant <= 20) {
            const s = sesion.servicio;
            setSesion(numero, { cantidad: cant });
            const metodos = getMetodosPago(db);
            setSesion(numero, { estado: 'pago', metodos });
            return responder(`${msgDetalle(s, cant)}\n\n${msgMetodosPago(metodos)}`);
        }
        if (t === 'cancelar' || t === 'no') {
            resetSesion(numero);
            return responder('✅ Sin problema. ¿En qué más te puedo ayudar?\n\nEscribe *menu* para volver al inicio.');
        }
        return responder('¿Cuántas cuentas deseas? Solo escribe el número (ej: *1*, *2*, *3*...)');
    }

    // ── ESTADO: PAGO ──────────────────────────────────────────────────────
    if (sesion.estado === 'pago') {
        const metodos = sesion.metodos || getMetodosPago(db);
        const idx = parseInt(t) - 1;
        const metodo = metodos[idx] || metodos.find(m => m.nombre.toLowerCase().includes(t));

        if (metodo) {
            const s    = sesion.servicio;
            const cant = sesion.cantidad || 1;
            const { pct: pctVolumen } = calcularDescuento(cant);
            const pctPuntos = sesion.descuentoPuntos || 0;
            const factorDesc = (1 - pctVolumen / 100) * (1 - pctPuntos / 100);
            const precioUnitario   = s.precio_usd ? +(s.precio_usd * factorDesc).toFixed(2) : null;
            const precioUnitarioBs = s.precio_bs  ? +(s.precio_bs  * factorDesc).toFixed(2) : null;
            const totalUsd = precioUnitario   ? +(precioUnitario   * cant).toFixed(2) : null;
            const totalBs  = precioUnitarioBs ? +(precioUnitarioBs * cant).toFixed(2) : null;

            const pedido = db.prepare(`INSERT INTO pedidos (cliente_id, servicio_id, metodo_pago, notas)
                VALUES (?, ?, ?, ?)`).run(cliente.id, s.id, metodo.nombre,
                `${cant}x ${s.nombre} | Total: Bs ${totalBs ?? '?'}${pctPuntos > 0 ? ` (incl. ${pctPuntos}% desc. puntos)` : ''}`);

            setSesion(numero, { estado: 'comprobante', pedidoId: pedido.lastInsertRowid, totalBs, totalUsd });

            let resumen = `✅ *Resumen del pedido #${pedido.lastInsertRowid}*\n🎬 ${cant}x ${s.nombre}\n`;
            if (pctVolumen > 0) resumen += `🎁 Desc. volumen: *${pctVolumen}%*\n`;
            if (pctPuntos  > 0) resumen += `⭐ Desc. puntos:  *${pctPuntos}%*\n`;
            if (totalBs)   resumen += `💰 Total: *Bs ${totalBs}*\n`;
            resumen += `💳 Método: *${metodo.nombre}*`;

            notificarAdmin(sock, db, `🛒 Nuevo pedido #${pedido.lastInsertRowid}\n👤 ${nombre} (${numero})\n🎬 ${cant}x ${s.nombre}\n💰 $${totalUsd ?? '?'} / Bs ${totalBs ?? '?'}\n💳 ${metodo.nombre}`);

            if (metodo.imagen) {
                const imgFile = path.join(IMG_PATH, 'qr', metodo.imagen);
                if (fs.existsSync(imgFile)) {
                    const caption = `${resumen}\n\n📸 Escanea este QR para pagar\n\n_Luego envíame el comprobante (captura de pantalla)_`;
                    await sock.sendMessage(jid, { image: fs.readFileSync(imgFile), caption });
                    logMensaje(db, numero, nombre, caption, 'bot');
                    return;
                }
            }

            let instrucciones = resumen + '\n\n';
            if (metodo.detalle) instrucciones += `📋 *Datos de pago:*\n${metodo.detalle}\n\n`;
            instrucciones += `📸 Por favor *envía el comprobante de pago* (imagen o captura) para confirmar tu pedido.`;
            return responder(instrucciones);
        }

        return responder(`Por favor elige el método de pago escribiendo su *número*:\n\n${msgMetodosPago(metodos)}`);
    }

    // ── ESTADO: COMPROBANTE ───────────────────────────────────────────────
    if (sesion.estado === 'comprobante') {
        const confirma = ['ya pagué', 'ya pague', 'pagué', 'pague', 'listo', 'hecho', 'ya envié', 'ya envie'].some(k => t.includes(k));
        if (confirma) {
            // Sin imagen: notificar admins con texto y mover a espera
            if (sesion.pedidoId) {
                db.prepare("UPDATE pedidos SET notas = notas || ' | Cliente confirmó pago (sin imagen)' WHERE id = ?").run(sesion.pedidoId);
            }
            notificarAdmin(sock, db,
                `💸 *PEDIDO #${sesion.pedidoId} — Cliente confirmó pago* (sin imagen)\n` +
                `👤 ${nombre} (${numero})\nVerificar manualmente.`
            );
            setSesion(numero, { estado: 'esperando_aprobacion' });
            return responder('✅ Recibido. Un asesor verificará tu pago y te enviará los accesos pronto ⏳');
        }
        return responder('📸 Envía la *imagen* del comprobante de pago.\nO escribe *ya pagué* si ya realizaste la transferencia.');
    }

    // ── ESTADO: ESPERANDO APROBACIÓN ─────────────────────────────────────
    if (sesion.estado === 'esperando_aprobacion') {
        return responder('⏳ Tu pago está siendo verificado. Un asesor lo aprobará en breve.\n\nEscribe *menu* si deseas volver al inicio.');
    }

    // ── ESTADO: CANJEAR CONFIRMAR ─────────────────────────────────────────
    if (sesion.estado === 'canjear_confirmar') {
        if (t === '1') {
            const servicios = getServicios(db);
            setSesion(numero, { estado: 'catalogo', servicios, descuentoPuntos: sesion.descuentoPct, umbralUsado: sesion.umbralUsado });
            return responder(`✅ Descuento del *${sesion.descuentoPct}%* activado 🎁\n\nElige el servicio:\n\n${msgCatalogo(servicios)}`);
        }
        if (t === '2') {
            resetSesion(numero);
            return responder('👍 Tus puntos están guardados. Escribe *canjear* cuando quieras usarlos.\n\nEscribe *menu* para volver al inicio.');
        }
        return responder(`*1* — Aplicar ahora\n*2* — Guardar para después`);
    }

    // ── ESTADO: HUMANO ────────────────────────────────────────────────────
    if (sesion.estado === 'humano') {
        notificarAdmin(sock, db, `💬 Mensaje de *${nombre}* (${numero}):\n"${texto}"`);
        return;
    }

    // ── FALLBACK: Gemini AI ───────────────────────────────────────────────
    await sock.sendPresenceUpdate('composing', jid);
    const respuesta = await aiService.chat(texto, numero);

    if (respuesta.includes('[NOTIFY_ADMIN]')) {
        notificarAdmin(sock, db, `🤖 IA detectó posible venta — Cliente: ${nombre} (${numero})\nMensaje: "${texto}"`);
        const clean = respuesta.replace('[NOTIFY_ADMIN]', '').trim();
        await responder(clean);
        return;
    }

    setSesion(numero, { estado: 'menu', _aiTurns: (sesion._aiTurns || 0) + 1 });
    await responder(respuesta);
    if ((sesion._aiTurns || 0) >= 2) {
        setSesion(numero, { _aiTurns: 0 });
        await responder(`💡 ¿Quieres ver nuestros servicios? Escribe *catalogo* o *1* 😊`);
    }
}

function enviar(sock, jid, texto) {
    return sock.sendMessage(jid, { text: texto });
}

// Llamado desde connection.js cuando llega una imagen
async function manejarImagen({ sock, jid, msg, numero, nombre, db }) {
    const sesion = getSesion(numero);
    if (sesion.estado !== 'comprobante') return;

    const pedidoId = sesion.pedidoId;

    // Responder al cliente de inmediato
    await enviar(sock, jid, '📸 Comprobante recibido. Un asesor verificará tu pago y te enviará los accesos en breve ⏳');
    logMensaje(db, numero, nombre, '📸 Comprobante recibido. Un asesor verificará tu pago y te enviará los accesos en breve ⏳', 'bot');
    setSesion(numero, { estado: 'esperando_aprobacion' });

    // Descargar imagen y procesar en background
    try {
        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const buffer = await downloadMediaMessage(msg, 'buffer', {});

        // Guardar imagen en disco
        const imgDir = path.join(IMG_PATH, 'comprobantes');
        fs.mkdirSync(imgDir, { recursive: true });
        const imgFilename = `pedido_${pedidoId}.jpg`;
        fs.writeFileSync(path.join(imgDir, imgFilename), buffer);
        db.prepare("UPDATE pedidos SET comprobante_imagen = ? WHERE id = ?").run(imgFilename, pedidoId);

        // Analizar con IA (si está habilitado en config)
        const { analizarComprobante } = require('../../services/aiService');
        const visionActivo = getConfig(db, 'vision_ia_activo', '1') === '1';
        const analisis = visionActivo
            ? await analizarComprobante(buffer, sesion.totalBs)
            : { banco: null, monto: null, fecha: null, valido: null, coincide: null, nota: 'Análisis IA desactivado' };
        db.prepare("UPDATE pedidos SET ai_analisis = ? WHERE id = ?").run(JSON.stringify(analisis), pedidoId);
        db.prepare("UPDATE pedidos SET notas = notas || ' | Comprobante recibido' WHERE id = ?").run(pedidoId);

        // Construir resumen para admins
        const pedido   = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
        const servicio = db.prepare('SELECT nombre FROM servicios WHERE id = ?').get(pedido?.servicio_id);

        const coincideIcon = analisis.coincide === true  ? '✅' :
                             analisis.coincide === false ? '⚠️' : '❓';
        const validoIcon   = analisis.valido   === true  ? '✅' :
                             analisis.valido   === false ? '🚨' : '❓';

        let bloqueIA = '';
        if (analisis.banco || analisis.monto) {
            bloqueIA =
                `\n🤖 *Análisis IA:*\n` +
                `  Banco: ${analisis.banco || '?'}\n` +
                `  Monto: Bs ${analisis.monto ?? '?'} ${coincideIcon}\n` +
                `  Fecha: ${analisis.fecha || '?'}\n` +
                `  Válido: ${validoIcon}\n` +
                (analisis.nota ? `  Nota: _${analisis.nota}_\n` : '');
        } else if (analisis.nota) {
            bloqueIA = `\n🤖 _IA: ${analisis.nota}_\n`;
        }

        const resumenAdmin =
            `🛒 *PEDIDO #${pedidoId} — COMPROBANTE*\n` +
            `👤 ${nombre} (${numero})\n` +
            `🎬 ${servicio?.nombre || '?'} · Bs ${sesion.totalBs ?? '?'}\n` +
            `💳 ${pedido?.metodo_pago || '?'}` +
            bloqueIA +
            `\n*1* — Tomar este pedido\n*2* — Ignorar`;

        // Notificar a todos los admins con la imagen
        const { setPendingNotification } = require('./adminHandler');
        const admins = db.prepare('SELECT telefono FROM admins WHERE activo = 1').all();
        for (const adm of admins) {
            const adminJid = `${adm.telefono}@s.whatsapp.net`;
            try {
                await sock.sendMessage(adminJid, { image: buffer, caption: resumenAdmin });
                setPendingNotification(adm.telefono, pedidoId);
            } catch (_) {}
        }
    } catch (e) {
        console.error('Error procesando comprobante:', e.message);
        // Fallback: notificar sin imagen
        notificarAdmin(sock, db,
            `💸 *PEDIDO #${pedidoId}* — Comprobante recibido (no se pudo analizar)\n👤 ${nombre} (${numero})`
        );
    }
}

module.exports = { manejar, manejarImagen };
