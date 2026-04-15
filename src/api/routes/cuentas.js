const router = require('express').Router();
const db     = require('../../db/database');

router.get('/', (req, res) => {
    const cuentas = db.prepare(`
        SELECT c.*, s.nombre as servicio_nombre,
               COUNT(CASE WHEN p.estado = 'libre' THEN 1 END) as perfiles_libres
        FROM cuentas c
        LEFT JOIN servicios s ON s.id = c.servicio_id
        LEFT JOIN perfiles p ON p.cuenta_id = c.id
        WHERE c.activa = 1
        GROUP BY c.id
    `).all();
    res.json(cuentas);
});

router.post('/', (req, res) => {
    const { servicio_id, correo, contrasena, tipo } = req.body;
    if (!correo || !contrasena) return res.status(400).json({ error: 'Datos incompletos' });
    const result = db.prepare('INSERT INTO cuentas (servicio_id, correo, contrasena, tipo) VALUES (?, ?, ?, ?)').run(servicio_id, correo, contrasena, tipo || 'perfil');
    res.json({ ok: true, id: result.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
    db.prepare('UPDATE cuentas SET activa = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
