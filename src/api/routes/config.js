const router = require('express').Router();
const db     = require('../../db/database');

const getConfig = (clave) => db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave)?.valor;
const setConfig = (clave, valor) => db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run(clave, valor);

// GET /api/config/public — datos públicos (sin auth)
router.get('/public', (req, res) => {
    res.json({
        nombre_empresa: getConfig('nombre_empresa'),
        nombre_bot:     getConfig('nombre_bot'),
        logo:           getConfig('logo'),
        moneda:         getConfig('moneda'),
        prompt_sistema: getConfig('saludo_bot'),
        color_primario: getConfig('color_primario')
    });
});

// POST /api/config — guardar configuración
router.post('/', (req, res) => {
    const { nombre_empresa, nombre_bot, moneda, prompt_sistema, logo } = req.body;
    if (nombre_empresa) setConfig('nombre_empresa', nombre_empresa);
    if (nombre_bot)     setConfig('nombre_bot', nombre_bot);
    if (moneda)         setConfig('moneda', moneda);
    if (prompt_sistema) setConfig('saludo_bot', prompt_sistema);
    if (logo)           setConfig('logo', logo);
    res.json({ ok: true });
});

module.exports = router;
