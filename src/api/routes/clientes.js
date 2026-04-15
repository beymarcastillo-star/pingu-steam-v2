const router = require('express').Router();
const db     = require('../../db/database');

router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM clientes ORDER BY registrado_en DESC').all());
});

module.exports = router;
