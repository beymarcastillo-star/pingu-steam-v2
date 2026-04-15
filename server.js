// =============================================
// PINGU STEAM V2 — server.js
// Punto de entrada principal
// =============================================
require('dotenv').config();

const express    = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);
const PORT       = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pasar io a las rutas que lo necesiten
app.set('io', io);

// ── RUTAS API ─────────────────────────────
app.use('/api/auth',      require('./src/api/routes/auth'));
app.use('/api/config',    require('./src/api/routes/config'));
app.use('/api/servicios', require('./src/api/routes/servicios'));
app.use('/api/cuentas',   require('./src/api/routes/cuentas'));
app.use('/api/pedidos',   require('./src/api/routes/pedidos'));
app.use('/api/clientes',  require('./src/api/routes/clientes'));
app.use('/api/admins',    require('./src/api/routes/admins'));
app.use('/api/ventas',    require('./src/api/routes/ventas'));
app.use('/api/stats',     require('./src/api/routes/stats'));
app.use('/api/media',     require('./src/api/routes/media'));
app.use('/api/pagos',     require('./src/api/routes/pagos'));
app.use('/api/bot',       require('./src/api/routes/bot'));

// Fallback: servir index.html para rutas no API
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// ── ARRANCAR SERVIDOR ─────────────────────
httpServer.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log(`║   🎬 PINGU STEAM V2 corriendo         ║`);
    console.log(`║   Panel: http://localhost:${PORT}       ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');
});

// ── ARRANCAR BOT WHATSAPP ─────────────────
const bot = require('./src/bot/connection');
bot.conectar(io);
