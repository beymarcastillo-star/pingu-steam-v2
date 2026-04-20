// =============================================
// SERVICIO DE IA — Gemini
// =============================================
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });

// Historial de conversación por usuario: { [userId]: { msgs: [], ts: number } }
const historiales = {};

// Limpiar historiales sin actividad por más de 2 horas
setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const uid of Object.keys(historiales)) {
        if (historiales[uid].ts < cutoff) delete historiales[uid];
    }
}, 30 * 60 * 1000).unref();

async function chat(texto, userId) {
    try {
        const db        = require('../db/database');
        const getConfig = db.getConfig;

        const nombreBot     = getConfig('nombre_bot',     'PinguBot');
        const nombreEmpresa = getConfig('nombre_empresa', 'Pingu Steam');
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

        if (!historiales[userId]) historiales[userId] = { msgs: [], ts: Date.now() };
        const h = historiales[userId];
        h.ts = Date.now();
        h.msgs.push({ role: 'user', parts: [{ text: texto }] });
        if (h.msgs.length > 10) h.msgs = h.msgs.slice(-10);

        const chat = model.startChat({
            history: h.msgs.slice(0, -1),
            systemInstruction: systemPrompt
        });

        const result = await chat.sendMessage(texto);
        const respuesta = result.response.text();

        h.msgs.push({ role: 'model', parts: [{ text: respuesta }] });

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
