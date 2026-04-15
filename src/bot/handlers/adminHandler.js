// =============================================
// HANDLER DE ADMINS (WhatsApp)
// Panel de control por chat
// =============================================

// Estado por admin
const estados = {};

async function manejar({ sock, jid, texto, numero, nombre, adminRow, db }) {
    const cmd = texto.toLowerCase();

    // Activar panel
    if (cmd === 'panel' || cmd === 'admin') {
        estados[numero] = { paso: 'menu' };
        await sock.sendMessage(jid, { text: menuPrincipal(adminRow) });
        return;
    }

    // Si no está en modo panel, ignorar
    if (!estados[numero]) return;

    // TODO: Implementar flujo completo del panel admin por WhatsApp
    await sock.sendMessage(jid, { text: '⚙️ Panel en construcción. Usa el panel web en http://localhost:3000' });
}

function menuPrincipal(admin) {
    return `👑 *PANEL ADMIN — ${admin.usuario}*\n\n` +
           `1️⃣ Ver pedidos pendientes\n` +
           `2️⃣ Ver stock disponible\n` +
           `3️⃣ Ver ventas de hoy\n\n` +
           `0️⃣ Salir\n\n` +
           `_O usa el panel web para más opciones_`;
}

module.exports = { manejar };
