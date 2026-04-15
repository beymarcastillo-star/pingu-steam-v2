const router = require('express').Router();
const db     = require('../../db/database');

// GET /api/servicios
router.get('/', (req, res) => {
    const servicios = db.prepare(`
        SELECT s.*,
               COUNT(CASE WHEN p.estado = 'libre' THEN 1 END) as libres
        FROM servicios s
        LEFT JOIN cuentas c ON c.servicio_id = s.id AND c.activa = 1
        LEFT JOIN perfiles p ON p.cuenta_id = c.id
        WHERE s.activo = 1
        GROUP BY s.id
    `).all();
    res.json(servicios);
});

// POST /api/servicios
router.post('/', (req, res) => {
    const { nombre, descripcion, imagen } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const result = db.prepare('INSERT INTO servicios (nombre, descripcion, imagen) VALUES (?, ?, ?)').run(nombre, descripcion || null, imagen || null);
    res.json({ ok: true, id: result.lastInsertRowid });
});

// DELETE /api/servicios/:id
router.delete('/:id', (req, res) => {
    db.prepare('UPDATE servicios SET activo = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
