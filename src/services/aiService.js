// =============================================
// SERVICIO DE IA — Gemini
// =============================================
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });

// Historial de conversación por usuario
const historiales = {};

async function chat(texto, userId) {
    try {
        const db = require('../db/database');

        // Obtener config del sistema
        const getConfig = (clave) => db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave)?.valor || '';
        const nombreBot     = getConfig('nombre_bot')     || 'PinguBot';
        const nombreEmpresa = getConfig('nombre_empresa') || 'Pingu Steam';
        const promptBase    = getConfig('saludo_bot')
            .replace('{bot}', nombreBot)
            .replace('{empresa}', nombreEmpresa);

        // Obtener servicios disponibles para contexto
        const servicios = db.prepare('SELECT nombre, descripcion FROM servicios WHERE activo = 1').all();
        const listaServicios = servicios.map(s => `- ${s.nombre}${s.descripcion ? ': ' + s.descripcion : ''}`).join('\n');

        const systemPrompt = `${promptBase}

Servicios disponibles:
${listaServicios || 'No hay servicios configurados aún'}

Instrucciones:
- Sé amable y usa emojis con moderación
- Si el cliente quiere comprar, pídele que indique el servicio y método de pago
- Cuando confirme el pago, responde con [NOTIFY_ADMIN] al inicio
- Responde siempre en español`;

        // Mantener historial por usuario (máx 10 mensajes)
        if (!historiales[userId]) historiales[userId] = [];
        historiales[userId].push({ role: 'user', parts: [{ text: texto }] });
        if (historiales[userId].length > 10) historiales[userId] = historiales[userId].slice(-10);

        const chat = model.startChat({
            history: historiales[userId].slice(0, -1),
            systemInstruction: systemPrompt
        });

        const result = await chat.sendMessage(texto);
        const respuesta = result.response.text();

        // Guardar respuesta en historial
        historiales[userId].push({ role: 'model', parts: [{ text: respuesta }] });

        return respuesta;
    } catch (e) {
        console.error('Error IA:', e.message);
        return '😅 Ups, tuve un problema. ¿Puedes repetir tu mensaje?';
    }
}

function limpiarHistorial(userId) {
    delete historiales[userId];
}

module.exports = { chat, limpiarHistorial };
