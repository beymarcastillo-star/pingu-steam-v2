// =============================================
// BOT WHATSAPP — connection.js
// =============================================
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino           = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const path           = require('path');
const fs             = require('fs');

const clientHandler = require('./handlers/clientHandler');
const adminHandler  = require('./handlers/adminHandler');

const AUTH_PATH = path.join(__dirname, '../../bot_auth');

let sock         = null;
let ioRef        = null;
let lastQR       = null;
let estado       = 'disconnected';
let ioReady      = false;

// ── HELPERS ───────────────────────────────
function emitir(evento, dato) {
    if (ioRef) ioRef.emit(evento, dato);
    if (evento === 'connection-status') estado = dato;
    if (evento === 'qr') lastQR = dato;
}

function limpiarAuth() {
    try {
        fs.rmSync(AUTH_PATH, { recursive: true, force: true });
        fs.mkdirSync(AUTH_PATH, { recursive: true });
    } catch (_) {}
}

// ── CONEXIÓN PRINCIPAL ────────────────────
async function conectar(io) {
    ioRef = io;

    // Enviar estado actual a cada socket nuevo que se conecte (solo registrar una vez)
    if (!ioReady) {
        ioReady = true;
        io.on('connection', (socket) => {
            socket.emit('connection-status', estado);
            if (lastQR && estado !== 'connected') socket.emit('qr', lastQR);
        });
    }

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: false,
        syncFullHistory: false,
    });

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrcodeTerminal.generate(qr, { small: true });
            console.log('📱 QR listo — escanea con WhatsApp');
            emitir('qr', qr);
            emitir('connection-status', 'disconnected');
        }

        if (connection === 'open') {
            lastQR = null;
            console.log('🟢 WhatsApp conectado');
            emitir('connection-status', 'connected');
        }

        if (connection === 'close') {
            const codigo = lastDisconnect?.error?.output?.statusCode;
            console.log(`🔴 Conexión cerrada — código: ${codigo ?? 'desconocido'}`);

            if (codigo === DisconnectReason.loggedOut) {
                // El usuario cerró sesión desde el teléfono → limpiar y pedir QR nuevo
                console.log('   Sesión cerrada desde el teléfono. Limpiando credenciales...');
                limpiarAuth();
                emitir('connection-status', 'disconnected');
                setTimeout(() => conectar(io), 5000);
                return;
            }

            if (codigo === DisconnectReason.badSession || codigo === 405) {
                // Credenciales corruptas o rechazadas → limpiar y esperar reconexión manual
                console.log('   Credenciales inválidas. Limpiando — usa el botón Reconectar en el panel.');
                limpiarAuth();
                emitir('connection-status', 'disconnected');
                // NO reconectar automáticamente — esperar acción del usuario
                return;
            }

            // Otros errores (red, timeout) → reintentar con backoff
            emitir('connection-status', 'connecting');
            const espera = 8000;
            console.log(`🟡 Reintentando en ${espera / 1000}s...`);
            setTimeout(() => conectar(io), espera);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg || msg.key.fromMe) return;
        // Ignorar estados de WhatsApp y mensajes de grupos
        const jid = msg.key.remoteJid || '';
        if (jid.includes('@g.us') || jid.includes('status@broadcast') || jid === 'status') return;
        try { await procesarMensaje(msg); }
        catch (e) { console.error('Error al procesar mensaje:', e.message); }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ── PROCESAR MENSAJES ─────────────────────
async function procesarMensaje(msg) {
    const db     = require('../db/database');
    const jid    = msg.key.remoteJid;
    const nombre = msg.pushName || 'Cliente';
    const numero = jid.split('@')[0];

    const content = msg.message || {};
    const texto = (
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        ''
    ).trim();

    const esImagen = !!(content.imageMessage || content.documentMessage);
    const admin    = db.prepare('SELECT * FROM admins WHERE telefono = ? AND activo = 1').get(numero);

    if (admin)         await adminHandler.manejar({ sock, jid, texto, numero, nombre, adminRow: admin, db });
    else if (esImagen) await clientHandler.manejarImagen({ sock, jid, numero, nombre, db });
    else               await clientHandler.manejar({ sock, jid, texto, numero, nombre, db });
}

// ── API PÚBLICA ───────────────────────────
function enviar(jid, contenido) {
    if (!sock) throw new Error('Bot no conectado');
    return sock.sendMessage(jid, contenido);
}

function desconectar() {
    if (sock) sock.logout();
}

function reconectar() {
    if (sock) { try { sock.end(); } catch (_) {} }
    setTimeout(() => conectar(ioRef), 1000);
}

function emitirAdmin(evento, dato) {
    if (ioRef) ioRef.emit(evento, dato);
}

module.exports = { conectar, enviar, desconectar, reconectar, emitirAdmin };
