// =============================================
// JOB — Recordatorios de vencimiento
// Corre cada hora, envía aviso a clientes cuyo
// perfil vence en los próximos N días.
// =============================================
const db = require('../db/database');

let intervaloId = null;

function start() {
    if (intervaloId) return;

    intervaloId = setInterval(verificarVencimientos, 60 * 60 * 1000);
    intervaloId.unref();

    // Primera ejecución 15 segundos después de arrancar (deja tiempo al bot de conectarse)
    setTimeout(verificarVencimientos, 15 * 1000);

    console.log('🔔 Job recordatorios iniciado (cada hora)');
}

async function verificarVencimientos() {
    if (db.getConfig('recordatorios_activo', '1') !== '1') return;

    const dias = Math.max(1, parseInt(db.getConfig('recordatorios_dias', '3')) || 3);

    // Fecha límite: hoy + N días
    const hoy        = new Date();
    const limite      = new Date();
    limite.setDate(limite.getDate() + dias);
    const hoyStr    = hoy.toISOString().slice(0, 10);
    const limiteStr = limite.toISOString().slice(0, 10);

    const perfiles = db.prepare(`
        SELECT pf.id, pf.nombre_perfil, pf.fecha_vencimiento,
               s.nombre  AS servicio_nombre,
               cl.whatsapp, cl.nombre AS cliente_nombre
        FROM perfiles pf
        JOIN cuentas  ct ON ct.id = pf.cuenta_id
        JOIN servicios s  ON s.id  = ct.servicio_id
        LEFT JOIN clientes cl ON cl.id = pf.cliente_id
        WHERE pf.estado = 'vendido'
          AND pf.fecha_vencimiento IS NOT NULL
          AND pf.fecha_vencimiento >= ?
          AND pf.fecha_vencimiento <= ?
          AND (pf.recordatorio_enviado IS NULL OR pf.recordatorio_enviado < ?)
    `).all(hoyStr, limiteStr, hoyStr);

    if (!perfiles.length) return;

    // Obtener referencia al bot (puede no estar conectado)
    let connection;
    try { connection = require('../bot/connection'); }
    catch (e) { console.error('Recordatorios: bot no disponible'); return; }

    const msgTpl = db.getConfig(
        'recordatorio_mensaje_cliente',
        '🔔 Hola *{nombre}*! Tu suscripción de *{servicio}* vence el *{fecha}* ({dias} días).\n\nEscribe *menu* para renovar y no perder el acceso 😊'
    );
    const admins = db.prepare("SELECT telefono FROM admins WHERE activo = 1").all();

    console.log(`🔔 Procesando ${perfiles.length} recordatorio(s)...`);
    let enviados = 0;

    for (const pf of perfiles) {
        try {
            // Calcular días restantes usando la fecha a medianoche para evitar horas
            const fechaVence    = new Date(pf.fecha_vencimiento + 'T00:00:00');
            const diasRestantes = Math.ceil((fechaVence - hoy) / (1000 * 60 * 60 * 24));
            const fechaFmt      = fechaVence.toLocaleDateString('es-BO', {
                day: 'numeric', month: 'long', year: 'numeric',
                timeZone: 'America/La_Paz',
            });

            // ── Notificar al cliente ───────────────────────────────────────
            if (pf.whatsapp) {
                const clienteJid = `${pf.whatsapp}@s.whatsapp.net`;
                const msg = msgTpl
                    .replace('{nombre}',    pf.cliente_nombre || 'Cliente')
                    .replace('{servicio}',  pf.servicio_nombre)
                    .replace('{fecha}',     fechaFmt)
                    .replace('{dias}',      String(diasRestantes));

                await connection.enviar(clienteJid, { text: msg }).catch(() => {});
            }

            // ── Notificar a los admins ─────────────────────────────────────
            const msgAdmin =
                `⏰ *VENCIMIENTO PRÓXIMO*\n` +
                `👤 ${pf.cliente_nombre || pf.whatsapp || '?'}\n` +
                `🎬 ${pf.servicio_nombre} — ${pf.nombre_perfil}\n` +
                `📅 Vence: ${fechaFmt} (${diasRestantes} día${diasRestantes !== 1 ? 's' : ''})\n\n` +
                `_Puedes renovar el perfil desde el panel web._`;

            for (const adm of admins) {
                await connection.enviar(`${adm.telefono}@s.whatsapp.net`, { text: msgAdmin }).catch(() => {});
            }

            // Marcar como enviado hoy para no repetir
            db.prepare("UPDATE perfiles SET recordatorio_enviado = ? WHERE id = ?").run(hoyStr, pf.id);
            enviados++;
        } catch (e) {
            console.error(`Error recordatorio perfil #${pf.id}:`, e.message);
        }
    }

    if (enviados > 0) console.log(`✅ Recordatorios enviados: ${enviados}`);
}

module.exports = { start, verificarVencimientos };
