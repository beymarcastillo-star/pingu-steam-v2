const router = require('express').Router();
const db     = require('../../db/database');

// GET /api/conversaciones — últimas conversaciones (una por contacto)
router.get('/', (req, res) => {
    const rows = db.prepare(`
        SELECT c.numero, c.nombre,
               c.mensaje as ultimo_mensaje,
               c.origen  as ultimo_origen,
               c.estado,
               c.fecha   as ultima_fecha,
               COUNT(*)  as total_mensajes
        FROM conversaciones c
        INNER JOIN (
            SELECT numero, MAX(fecha) as max_fecha
            FROM conversaciones
            GROUP BY numero
        ) last ON c.numero = last.numero AND c.fecha = last.max_fecha
        GROUP BY c.numero
        ORDER BY c.fecha DESC
        LIMIT 50
    `).all();
    res.json(rows);
});

// GET /api/conversaciones/:numero — hilo completo de un contacto
router.get('/:numero', (req, res) => {
    const rows = db.prepare(`
        SELECT * FROM conversaciones
        WHERE numero = ?
        ORDER BY fecha ASC
        LIMIT 100
    `).all(req.params.numero);
    res.json(rows);
});

// DELETE /api/conversaciones/:numero — borrar historial de un contacto
router.delete('/:numero', (req, res) => {
    db.prepare('DELETE FROM conversaciones WHERE numero = ?').run(req.params.numero);
    res.json({ ok: true });
});

module.exports = router;
