const router    = require('express').Router();
const bot       = require('../../bot/connection');
const aiService = require('../../services/aiService');

router.get('/groups', async (_req, res) => {
    try {
        const grupos = await bot.obtenerGrupos();
        res.json(grupos);
    } catch (e) {
        res.status(503).json({ error: e.message });
    }
});

router.post('/reconnect', (req, res) => {
    bot.reconectar();
    res.json({ ok: true });
});

router.post('/disconnect', (req, res) => {
    bot.desconectar();
    res.json({ ok: true });
});

// POST /api/bot/test-ia — probar el prompt desde el panel
router.post('/test-ia', async (req, res) => {
    const { mensaje } = req.body;
    if (!mensaje) return res.status(400).json({ error: 'mensaje requerido' });
    try {
        const respuesta = await aiService.chat(mensaje, '__panel_test__');
        res.json({ respuesta: respuesta.replace('[NOTIFY_ADMIN]', '').trim() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/bot/vencimientos?dias=7 — perfiles próximos a vencer
router.get('/vencimientos', (req, res) => {
    const db   = require('../../db/database');
    const dias = Math.max(1, parseInt(req.query.dias) || parseInt(db.getConfig('recordatorios_dias', '3')) || 3);

    const hoy        = new Date().toISOString().slice(0, 10);
    const limite     = new Date();
    limite.setDate(limite.getDate() + dias);
    const limiteStr  = limite.toISOString().slice(0, 10);

    const perfiles = db.prepare(`
        SELECT pf.id, pf.nombre_perfil, pf.fecha_vencimiento, pf.recordatorio_enviado,
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
        ORDER BY pf.fecha_vencimiento ASC
    `).all(hoy, limiteStr);

    res.json(perfiles);
});

// POST /api/bot/recordatorios — ejecutar job manualmente
router.post('/recordatorios', async (_req, res) => {
    try {
        const { verificarVencimientos } = require('../../jobs/recordatorios');
        await verificarVencimientos();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
