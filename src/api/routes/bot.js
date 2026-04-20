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

module.exports = router;
