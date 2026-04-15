const router = require('express').Router();
const db     = require('../../db/database');

router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM metodos_pago WHERE activo = 1').all());
});

router.post('/', (req, res) => {
    const { nombre, tipo, detalle, imagen } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const result = db.prepare('INSERT INTO metodos_pago (nombre, tipo, detalle, imagen) VALUES (?, ?, ?, ?)').run(nombre, tipo || 'qr', detalle || null, imagen || null);
    res.json({ ok: true, id: result.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
    db.prepare('UPDATE metodos_pago SET activo = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
