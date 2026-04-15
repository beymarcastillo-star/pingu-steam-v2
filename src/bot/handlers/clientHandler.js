// =============================================
// HANDLER DE CLIENTES
// Lógica de conversación para clientes
// =============================================
const aiService = require('../../services/aiService');

// Estado de conversación en memoria (por número)
const estados = {};

async function manejar({ sock, jid, texto, numero, nombre, db }) {
    // Registrar cliente si es nuevo
    const existe = db.prepare('SELECT id FROM clientes WHERE whatsapp = ?').get(numero);
    if (!existe) {
        db.prepare('INSERT INTO clientes (whatsapp, nombre) VALUES (?, ?)').run(numero, nombre);
    }

    // TODO: Implementar flujo de conversación
    // Por ahora redirige todo a la IA
    await sock.sendPresenceUpdate('composing', jid);
    const respuesta = await aiService.chat(texto, numero);
    await sock.sendMessage(jid, { text: respuesta });
}

module.exports = { manejar };
