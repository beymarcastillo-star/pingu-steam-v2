const router = require('express').Router();
const db     = require('../../db/database');

router.get('/', (req, res) => {
    res.json({ admins: db.prepare('SELECT id, usuario, telefono, rol, activo FROM admins').all() });
});

router.post('/', (req, res) => {
    const { usuario, telefono, rol } = req.body;
    if (!usuario || !telefono) return res.status(400).json({ error: 'Datos incompletos' });
    try {
        db.prepare('INSERT INTO admins (usuario, telefono, rol) VALUES (?, ?, ?)').run(usuario, telefono, rol || 'admin');
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: 'El usuario o teléfono ya existe' });
    }
});

router.delete('/:usuario', (req, res) => {
    const admin = db.prepare('SELECT * FROM admins WHERE usuario = ?').get(req.params.usuario);
    if (!admin) return res.status(404).json({ error: 'No encontrado' });
    if (admin.rol === 'super_admin') return res.status(403).json({ error: 'No puedes eliminar al Super Admin' });
    db.prepare('DELETE FROM admins WHERE usuario = ?').run(req.params.usuario);
    res.json({ ok: true });
});

module.exports = router;
