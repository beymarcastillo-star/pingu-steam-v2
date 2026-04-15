const router = require('express').Router();
const bot    = require('../../bot/connection');

router.post('/reconnect', (req, res) => {
    bot.reconectar();
    res.json({ ok: true });
});

router.post('/disconnect', (req, res) => {
    bot.desconectar();
    res.json({ ok: true });
});

module.exports = router;
