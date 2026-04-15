// =============================================
// BOT WHATSAPP — connection.js
// Manejo de conexión con Baileys
// =============================================
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino           = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const path           = require('path');

const clientHandler  = require('./handlers/clientHandler');
const adminHandler   = require('./handlers/adminHandler');

const AUTH_PATH    = path.join(__dirname, '../../bot_auth');
const MAX_REINTENTOS = 5;
const CODIGOS_SIN_RECONEXION = [
    DisconnectReason.loggedOut,
    DisconnectReason.badSession,
    405  // WhatsApp rechaza la sesión — hay que escanear QR de nuevo
];

let sock        = null;
let ioRef       = null;
let reintentos  = 0;
let timerRecon  = null;

async function conectar(io) {
    ioRef = io;

    // Limpiar timer previo si existe
    if (timerRecon) { clearTimeout(timerRecon); timerRecon = null; }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Desktop'),   // versión reconocida por WhatsApp
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 15000
    });

    // ── EVENTOS DE CONEXIÓN ────────────────
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrcodeTerminal.generate(qr, { small: true });
            console.log('📱 Escanea el QR con WhatsApp');
            if (ioRef) ioRef.emit('qr', qr);
        }

        if (connection === 'open') {
            reintentos = 0;
            console.log('🟢 WhatsApp conectado');
            if (ioRef) ioRef.emit('connection-status', 'connected');
        }

        if (connection === 'close') {
            const codigo = lastDisconnect?.error?.output?.statusCode;
            const sinReconexion = CODIGOS_SIN_RECONEXION.includes(codigo);

            if (sinReconexion) {
                console.log(`🔴 Desconectado (código ${codigo}) — se requiere escanear QR nuevamente.`);
                console.log('   Reinicia el servidor para obtener un nuevo QR.');
                if (ioRef) ioRef.emit('connection-status', 'disconnected');
                return; // No reconectar automáticamente
            }

            reintentos++;
            if (reintentos > MAX_REINTENTOS) {
                console.log(`🔴 Se alcanzó el máximo de reintentos (${MAX_REINTENTOS}). Deteniéndose.`);
                console.log('   Reinicia el servidor manualmente.');
                if (ioRef) ioRef.emit('connection-status', 'disconnected');
                return;
            }

            // Backoff exponencial: 3s, 6s, 12s, 24s, 48s
            const espera = Math.min(3000 * Math.pow(2, reintentos - 1), 60000);
            console.log(`🟡 Reintentando conexión (${reintentos}/${MAX_REINTENTOS}) en ${espera/1000}s...`);
            if (ioRef) ioRef.emit('connection-status', 'connecting');
            timerRecon = setTimeout(() => conectar(io), espera);
        }
    });

    // ── MENSAJES ENTRANTES ─────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg || msg.key.fromMe) return;

        try {
            await procesarMensaje(msg);
        } catch (e) {
            console.error('Error procesando mensaje:', e.message);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

async function procesarMensaje(msg) {
    const db       = require('../db/database');
    const jid      = msg.key.remoteJid;
    const texto    = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    const nombre   = msg.pushName || 'Cliente';
    const numero   = jid.split('@')[0];

    // Determinar si es admin
    const adminRow = db.prepare('SELECT * FROM admins WHERE telefono = ? AND activo = 1').get(numero);
    const esAdmin  = !!adminRow;

    if (esAdmin) {
        await adminHandler.manejar({ sock, jid, texto, numero, nombre, adminRow, db });
    } else {
        await clientHandler.manejar({ sock, jid, texto, numero, nombre, db });
    }
}

// Función para enviar mensaje desde la API
function enviar(jid, contenido) {
    if (!sock) throw new Error('Bot no conectado');
    return sock.sendMessage(jid, contenido);
}

function desconectar() {
    if (sock) sock.logout();
}

function reconectar() {
    if (sock) sock.end();
    conectar(ioRef);
}

module.exports = { conectar, enviar, desconectar, reconectar };
