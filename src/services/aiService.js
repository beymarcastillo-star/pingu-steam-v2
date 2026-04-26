// =============================================
// SERVICIO DE IA — DeepSeek
// =============================================
const OpenAI = require('openai');
const fs     = require('fs');

const client = new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey:  process.env.DEEPSEEK_API_KEY,
});

const MODEL        = process.env.DEEPSEEK_MODEL        || 'deepseek-chat';
const MODEL_VISION = process.env.DEEPSEEK_VISION_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const MAX_VISION_BYTES = 3 * 1024 * 1024; // 3 MB límite para enviar a la API

// Historial por usuario: { [userId]: { msgs: [], ts: number } }
const historiales = {};

setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const uid of Object.keys(historiales)) {
        if (historiales[uid].ts < cutoff) delete historiales[uid];
    }
}, 30 * 60 * 1000).unref();

// ── CHAT CLIENTE ──────────────────────────────────────────────────────────
async function chat(texto, userId) {
    try {
        const db        = require('../db/database');
        const getConfig = db.getConfig;

        const nombreBot     = getConfig('nombre_bot',     'PinguBot');
        const nombreEmpresa = getConfig('nombre_empresa', 'Pingu Steam');
        const promptBase    = getConfig('saludo_bot')
            .replace('{bot}',     nombreBot)
            .replace('{empresa}', nombreEmpresa);

        const tc = parseFloat(getConfig('tipo_cambio', '6.96'));
        const servicios = db.prepare(`
            SELECT s.nombre, s.descripcion, s.precio_usd,
                   COUNT(CASE WHEN p.estado = 'libre' THEN 1 END) as libres
            FROM servicios s
            LEFT JOIN cuentas c  ON c.servicio_id = s.id AND c.activa = 1
            LEFT JOIN perfiles p ON p.cuenta_id = c.id
            WHERE s.activo = 1
            GROUP BY s.id
        `).all();

        const listaServicios = servicios.map(s => {
            const precioBs = s.precio_usd ? ` — Bs ${(s.precio_usd * tc).toFixed(2)}` : ' — precio a consultar';
            const stock    = s.libres > 0 ? 'disponible' : 'sin stock';
            return `- ${s.nombre}${precioBs} (${stock})${s.descripcion ? ': ' + s.descripcion : ''}`;
        }).join('\n');

        const metodos = db.prepare("SELECT nombre FROM metodos_pago WHERE activo = 1").all();
        const listaMetodos = metodos.map(m => m.nombre).join(', ') || 'transferencia, QR';

        const systemPrompt =
            `${promptBase}\n\n` +
            `Servicios disponibles (con precios reales en Bs):\n${listaServicios || 'No hay servicios configurados aún'}\n\n` +
            `Métodos de pago aceptados: ${listaMetodos}\n\n` +
            `Reglas ESTRICTAS — nunca las rompas:\n` +
            `- NUNCA inventes precios. Usa SOLO los precios indicados arriba.\n` +
            `- NUNCA digas que un pago fue procesado, confirmado o que el acceso fue enviado. Eso lo hace un humano.\n` +
            `- NUNCA inventes cuentas, correos, contraseñas ni credenciales.\n` +
            `- Si el cliente quiere comprar: confirma servicio, cantidad y método de pago.\n` +
            `- Cuando el cliente confirme el método de pago, responde con [NOTIFY_ADMIN] al inicio y pídele que envíe el comprobante de pago como imagen.\n` +
            `- Si preguntan por algo que no sabes, di que un asesor lo resolverá.\n` +
            `- Responde siempre en español, sé amable y usa emojis con moderación.`;

        if (!historiales[userId]) historiales[userId] = { msgs: [], ts: Date.now() };
        const h = historiales[userId];
        h.ts = Date.now();
        h.msgs.push({ role: 'user', content: texto });
        if (h.msgs.length > 20) h.msgs = h.msgs.slice(-20);

        const response = await client.chat.completions.create({
            model:    MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                ...h.msgs,
            ],
            max_tokens: 512,
        });

        const respuesta = response.choices[0].message.content;
        h.msgs.push({ role: 'assistant', content: respuesta });

        return respuesta;
    } catch (e) {
        console.error('Error IA chat:', e.message);
        return '😅 Ups, tuve un problema. ¿Puedes repetir tu mensaje?';
    }
}

// ── CHAT ADMIN (lenguaje natural) ─────────────────────────────────────────
async function chatAdmin(texto, adminId, contexto = '') {
    try {
        const db        = require('../db/database');
        const getConfig = db.getConfig;

        const nombreEmpresa = getConfig('nombre_empresa', 'Pingu Steam');

        const systemPrompt =
            `Eres el asistente interno de ${nombreEmpresa}. Solo respondes a administradores verificados.\n` +
            `Ayudas a gestionar el negocio: pedidos, stock, cuentas, clientes y ventas.\n` +
            `Responde siempre en español, de forma concisa. Usa emojis con moderación.\n\n` +
            `Contexto actual del sistema:\n${contexto}`;

        if (!historiales[adminId]) historiales[adminId] = { msgs: [], ts: Date.now() };
        const h = historiales[adminId];
        h.ts = Date.now();
        h.msgs.push({ role: 'user', content: texto });
        if (h.msgs.length > 20) h.msgs = h.msgs.slice(-20);

        const response = await client.chat.completions.create({
            model:    MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                ...h.msgs,
            ],
            max_tokens: 512,
        });

        const respuesta = response.choices[0].message.content;
        h.msgs.push({ role: 'assistant', content: respuesta });

        return respuesta;
    } catch (e) {
        console.error('Error IA admin:', e.message);
        return '❌ Error al procesar tu consulta. Intenta de nuevo.';
    }
}

// ── ANÁLISIS DE COMPROBANTE (visión) ─────────────────────────────────────
async function analizarComprobante(imagenBuffer, totalEsperadoBs = null) {
    try {
        // Verificar tamaño antes de enviar
        if (imagenBuffer.length > MAX_VISION_BYTES) {
            console.warn(`[Vision] Imagen grande: ${(imagenBuffer.length / 1024 / 1024).toFixed(1)} MB — puede fallar`);
        }

        const base64 = imagenBuffer.toString('base64');
        const mime   = imagenBuffer[0] === 0x89 ? 'image/png' : 'image/jpeg';

        const prompt =
            `Eres un asistente que analiza comprobantes de pago bolivianos.\n` +
            `Bancos/billeteras comunes en Bolivia: BCP, BNB, Banco Unión, Banco Mercantil Santa Cruz (BMSC), ` +
            `Banco Bisa, Banco FIE, Tigo Money, Billetera Móvil (ENTEL), QR Simple, Safi, ` +
            `transferencia interbancaria, depósito en efectivo.\n\n` +
            `Analiza la imagen del comprobante y extrae:\n` +
            `1. banco: nombre del banco o billetera (texto corto)\n` +
            `2. monto: importe en Bs como número decimal (solo el número, sin "Bs" ni "BOB")\n` +
            `3. fecha: fecha y hora como aparece en el comprobante\n` +
            `4. valido: true si parece auténtico, false si parece editado/falso\n` +
            (totalEsperadoBs
                ? `5. coincide: true si el monto coincide con Bs ${totalEsperadoBs} (tolerancia ±0.50 Bs)\n`
                : `5. coincide: null (no hay monto esperado)\n`) +
            `6. nota: observación breve si hay algo importante (ej: "monto no coincide", "imagen borrosa", "parece editado")\n\n` +
            `Responde ÚNICAMENTE con este JSON exacto, sin texto adicional:\n` +
            `{"banco":"...","monto":0.00,"fecha":"...","valido":true,"coincide":true,"nota":"..."}`;

        const response = await client.chat.completions.create({
            model: MODEL_VISION,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
                    { type: 'text', text: prompt },
                ],
            }],
            max_tokens: 300,
        });

        const raw  = response.choices[0].message.content.trim();
        const json = raw.match(/\{[\s\S]*?\}/)?.[0];
        if (!json) throw new Error(`Respuesta no es JSON: ${raw.slice(0, 100)}`);

        const parsed = JSON.parse(json);
        // Normalizar monto a número
        if (typeof parsed.monto === 'string') {
            parsed.monto = parseFloat(parsed.monto.replace(/[^\d.]/g, '')) || null;
        }
        return parsed;
    } catch (e) {
        console.error('Error analizarComprobante:', e.message);
        return { banco: null, monto: null, fecha: null, valido: null, coincide: null, nota: `Error IA: ${e.message.slice(0, 80)}` };
    }
}

function limpiarHistorial(userId) {
    delete historiales[userId];
}

module.exports = { chat, chatAdmin, analizarComprobante, limpiarHistorial };
