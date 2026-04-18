// =============================================
// HANDLER DE CLIENTES — Flujo de conversación
// =============================================
const aiService = require('../../services/aiService');
const fs   = require('fs');
const path = require('path');

const IMG_PATH = path.join(__dirname, '../../../public/img');

// Sesiones en memoria: { estado, servicioId, servicioNombre, cantidad, pedidoId }
const sesiones = {};

function getSesion(numero) {
    if (!sesiones[numero]) sesiones[numero] = { estado: 'inicio' };
    return sesiones[numero];
}
function setSesion(numero, data) {
    sesiones[numero] = { ...sesiones[numero], ...data };
}
function resetSesion(numero) {
    sesiones[numero] = { estado: 'inicio' };
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function getConfig(db, clave, def = '') {
    return db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave)?.valor || def;
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
    let puntos = 5;
    if (monto_bs > 100) puntos = 30;
    else if (monto_bs > 50) puntos = 15;

    db.transaction(() => {
        db.prepare('UPDATE clientes SET puntos = puntos + ? WHERE id = ?').run(puntos, clienteId);
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

    // ── COMANDOS GLOBALES (funcionan en cualquier estado) ─────────────────
    if (['menu', 'inicio', 'start', '/start'].includes(t)) {
        resetSesion(numero);
        return enviar(sock, jid, msgMenu(db, nombre));
    }

    if (['mis puntos', 'puntos', 'mis pts'].includes(t)) {
        const pts = cliente?.puntos || 0;
        const descuentoDisponible = pts >= 200 ? 35 : pts >= 100 ? 15 : pts >= 50 ? 5 : 0;
        let msg = `⭐ *Tus puntos acumulados: ${pts}*\n\n`;
        if (descuentoDisponible > 0) {
            msg += `🎁 ¡Puedes canjear Bs ${descuentoDisponible} de descuento!\nEscribe *canjear* para aplicarlo en tu próxima compra.`;
        } else {
            const falta = 50 - pts;
            msg += `Acumula *${falta > 0 ? falta : 0} puntos más* para obtener tu primer descuento 💪\n\n`;
            msg += `_Ganas puntos en cada compra que realices._`;
        }
        return enviar(sock, jid, msg);
    }

    if (['catalogo', 'catálogo', 'ver', 'servicios'].includes(t)) {
        const servicios = getServicios(db);
        setSesion(numero, { estado: 'catalogo', servicios });
        return enviar(sock, jid, msgCatalogo(servicios));
    }

    // ── ESTADO: INICIO ────────────────────────────────────────────────────
    if (sesion.estado === 'inicio') {
        setSesion(numero, { estado: 'menu' });
        return enviar(sock, jid, msgMenu(db, nombre));
    }

    // ── ESTADO: MENU ──────────────────────────────────────────────────────
    if (sesion.estado === 'menu') {
        if (t === '1') {
            const servicios = getServicios(db);
            setSesion(numero, { estado: 'catalogo', servicios });
            return enviar(sock, jid, msgCatalogo(servicios));
        }
        if (t === '2') {
            // Reusar lógica de puntos — cambiar estado y responder
            const pts = cliente?.puntos || 0;
            const msg = pts >= 50
                ? `⭐ Tienes *${pts} puntos*!\n🎁 Escribe *canjear* para aplicar un descuento.`
                : `⭐ Tienes *${pts} puntos*.\nAcumula ${50 - pts} más para tu primer descuento 💪`;
            setSesion(numero, { estado: 'menu' });
            return enviar(sock, jid, msg);
        }
        if (t === '3') {
            notificarAdmin(sock, db, `📞 Cliente *${nombre}* (${numero}) quiere hablar con un humano.`);
            setSesion(numero, { estado: 'humano' });
            return enviar(sock, jid, '👤 ¡Claro! Ya le avisé a un asesor. En breve te contactamos 😊\n\nEscribe *menu* si deseas volver al menú.');
        }
        // Texto libre → IA
    }

    // ── ESTADO: CATÁLOGO — el cliente elige un servicio ───────────────────
    if (sesion.estado === 'catalogo') {
        const servicios = sesion.servicios || getServicios(db);

        // Buscar por número
        const idx = parseInt(t) - 1;
        let elegido = (!isNaN(idx) && idx >= 0) ? servicios[idx] : null;

        // Buscar por nombre si no encontró por número
        if (!elegido) {
            elegido = servicios.find(s => s.nombre.toLowerCase().includes(t));
        }

        if (elegido) {
            if (elegido.libres <= 0) {
                notificarAdmin(sock, db, `⚠️ Cliente *${nombre}* (${numero}) pidió *${elegido.nombre}* pero no hay stock.`);
                setSesion(numero, { estado: 'menu' });
                return enviar(sock, jid,
                    `😔 Lamentablemente *${elegido.nombre}* no tiene stock ahora mismo.\n` +
                    `Te avisaremos cuando haya disponibilidad 🙏\n\n¿Quieres ver otro servicio? Escribe *catalogo*`
                );
            }
            setSesion(numero, { estado: 'cantidad', servicioId: elegido.id, servicioNombre: elegido.nombre, servicio: elegido });
            return enviar(sock, jid,
                `${msgDetalle(elegido, 1)}\n\n` +
                `¿*Cuántas cuentas* deseas? Escribe el número 👇\n` +
                `_(Lleva 2+ y obtienes descuento 🎁)_`
            );
        }
        // No encontró servicio → IA con contexto de catálogo
    }

    // ── ESTADO: CANTIDAD ───────────────────────────────────────────────────
    if (sesion.estado === 'cantidad') {
        const cant = parseInt(t);
        if (!isNaN(cant) && cant >= 1 && cant <= 20) {
            const s = sesion.servicio;
            setSesion(numero, { cantidad: cant });

            const metodos = getMetodosPago(db);
            const resumen = msgDetalle(s, cant);
            setSesion(numero, { estado: 'pago', metodos });
            return enviar(sock, jid, `${resumen}\n\n${msgMetodosPago(metodos)}`);
        }
        if (t === 'cancelar' || t === 'no') {
            resetSesion(numero);
            return enviar(sock, jid, '✅ Sin problema. ¿En qué más te puedo ayudar?\n\nEscribe *menu* para volver al inicio.');
        }
        return enviar(sock, jid, '¿Cuántas cuentas deseas? Solo escribe el número (ej: *1*, *2*, *3*...)');
    }

    // ── ESTADO: PAGO ───────────────────────────────────────────────────────
    if (sesion.estado === 'pago') {
        const metodos = sesion.metodos || getMetodosPago(db);
        const idx = parseInt(t) - 1;
        const metodo = metodos[idx] || metodos.find(m => m.nombre.toLowerCase().includes(t));

        if (metodo) {
            // Calcular total final
            const s    = sesion.servicio;
            const cant = sesion.cantidad || 1;
            const { pct } = calcularDescuento(cant);
            const precioUnitario = s.precio_usd ? +(s.precio_usd * (1 - pct / 100)).toFixed(2) : null;
            const precioUnitarioBs = s.precio_bs ? +(s.precio_bs * (1 - pct / 100)).toFixed(2) : null;
            const totalUsd = precioUnitario ? +(precioUnitario * cant).toFixed(2) : null;
            const totalBs  = precioUnitarioBs ? +(precioUnitarioBs * cant).toFixed(2) : null;

            // Crear pedido en la DB
            const pedido = db.prepare(`
                INSERT INTO pedidos (cliente_id, servicio_id, metodo_pago, notas)
                VALUES (?, ?, ?, ?)
            `).run(
                cliente.id,
                s.id,
                metodo.nombre,
                `${cant}x ${s.nombre} | Total: $${totalUsd ?? '?'} / Bs ${totalBs ?? '?'}`
            );

            setSesion(numero, { estado: 'comprobante', pedidoId: pedido.lastInsertRowid, totalBs, totalUsd });

            let resumen = `✅ *Resumen del pedido #${pedido.lastInsertRowid}*\n`;
            resumen += `🎬 ${cant}x ${s.nombre}\n`;
            if (totalUsd) resumen += `💰 Total: *$${totalUsd} / Bs ${totalBs}*\n`;
            resumen += `💳 Método: *${metodo.nombre}*`;

            notificarAdmin(sock, db,
                `🛒 Nuevo pedido #${pedido.lastInsertRowid}\n` +
                `👤 Cliente: ${nombre} (${numero})\n` +
                `🎬 ${cant}x ${s.nombre}\n` +
                `💰 Total: $${totalUsd ?? '?'} / Bs ${totalBs ?? '?'}\n` +
                `💳 Método: ${metodo.nombre}`
            );

            // Si el método tiene imagen QR, enviarla con el monto como caption
            if (metodo.imagen) {
                const imgFile = path.join(IMG_PATH, 'qr', metodo.imagen);
                if (fs.existsSync(imgFile)) {
                    const caption = `${resumen}\n\n📸 Escanea este QR para pagar\n\n_Luego envíame el comprobante (captura de pantalla)_`;
                    await sock.sendMessage(jid, { image: fs.readFileSync(imgFile), caption });
                    return;
                }
            }

            // Sin imagen: enviar texto con instrucciones
            let instrucciones = resumen + '\n\n';
            if (metodo.detalle) instrucciones += `📋 *Datos de pago:*\n${metodo.detalle}\n\n`;
            instrucciones += `📸 Por favor *envía el comprobante de pago* (imagen o captura) para confirmar tu pedido.`;
            return enviar(sock, jid, instrucciones);
        }

        return enviar(sock, jid, `Por favor elige el método de pago escribiendo su *número*:\n\n${msgMetodosPago(metodos)}`);
    }

    // ── ESTADO: COMPROBANTE ────────────────────────────────────────────────
    if (sesion.estado === 'comprobante') {
        // Verificar si hay imagen en el mensaje (lo verifica connection.js antes de llamar acá)
        // también aceptamos texto de confirmación
        const confirma = ['ya pagué', 'ya pague', 'pagué', 'pague', 'listo', 'hecho', 'ya envié', 'ya envie'].some(k => t.includes(k));

        if (sesion._tieneImagen || confirma) {
            const pts = sumarPuntos(db, cliente.id, sesion.totalBs || 0);
            if (sesion.pedidoId) {
                db.prepare("UPDATE pedidos SET notas = notas || ' | Comprobante recibido' WHERE id = ?")
                  .run(sesion.pedidoId);
            }
            notificarAdmin(sock, db,
                `💸 Comprobante recibido del pedido #${sesion.pedidoId}\n` +
                `👤 ${nombre} (${numero})\n` +
                `Por favor verificar y entregar acceso.`
            );
            resetSesion(numero);
            return enviar(sock, jid,
                `✅ ¡Comprobante recibido! Un asesor verificará tu pago y te enviará los accesos en breve 🚀\n\n` +
                `⭐ *+${pts} puntos* agregados a tu cuenta por esta compra!\n\n` +
                `Escribe *mis puntos* para ver tu saldo 😊`
            );
        }

        return enviar(sock, jid,
            '📸 Envía la imagen del comprobante de pago para confirmar tu pedido.\n' +
            'Si ya pagaste, escribe *ya pagué*.'
        );
    }

    // ── ESTADO: HUMANO (esperando que admin atienda) ───────────────────────
    if (sesion.estado === 'humano') {
        // Reenviar el mensaje al admin como relay
        notificarAdmin(sock, db, `💬 Mensaje de *${nombre}* (${numero}):\n"${texto}"`);
        return; // No responder automáticamente, el admin lo hace desde su WA
    }

    // ── FALLBACK: Gemini AI ────────────────────────────────────────────────
    await sock.sendPresenceUpdate('composing', jid);
    const respuesta = await aiService.chat(texto, numero);

    // Si Gemini detecta intención de compra, redirigir al catálogo
    if (respuesta.includes('[NOTIFY_ADMIN]')) {
        notificarAdmin(sock, db, `🤖 IA detectó posible venta — Cliente: ${nombre} (${numero})\nMensaje: "${texto}"`);
        const clean = respuesta.replace('[NOTIFY_ADMIN]', '').trim();
        await enviar(sock, jid, clean);
        return;
    }

    // Si llevamos 2+ mensajes en IA sin estado, sugerir el menú
    setSesion(numero, { estado: 'menu', _aiTurns: (sesion._aiTurns || 0) + 1 });
    await enviar(sock, jid, respuesta);
    if ((sesion._aiTurns || 0) >= 2) {
        setSesion(numero, { _aiTurns: 0 });
        await enviar(sock, jid, `💡 ¿Quieres ver nuestros servicios? Escribe *catalogo* o *1* 😊`);
    }
}

function enviar(sock, jid, texto) {
    return sock.sendMessage(jid, { text: texto });
}

// Llamado desde connection.js cuando llega una imagen
async function manejarImagen({ sock, jid, numero, nombre, db }) {
    const sesion = getSesion(numero);
    if (sesion.estado === 'comprobante') {
        setSesion(numero, { _tieneImagen: true });
        await manejar({ sock, jid, texto: 'ya pagué', numero, nombre, db });
    }
}

module.exports = { manejar, manejarImagen };
