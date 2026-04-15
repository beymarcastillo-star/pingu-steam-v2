const router = require('express').Router();
const db     = require('../../db/database');

router.get('/', (req, res) => {
    const hoy = new Date().toISOString().slice(0, 10);

    const pedidosPendientes = db.prepare("SELECT COUNT(*) as n FROM pedidos WHERE estado = 'pendiente'").get().n;
    const perfilesLibres    = db.prepare("SELECT COUNT(*) as n FROM perfiles WHERE estado = 'libre'").get().n;
    const totalClientes     = db.prepare('SELECT COUNT(*) as n FROM clientes').get().n;
    const ventasHoy         = db.prepare("SELECT COALESCE(SUM(precio),0) as total FROM ventas WHERE fecha LIKE ?").get(hoy + '%').total;

    res.json({ pedidosPendientes, perfilesLibres, totalClientes, ventasHoy });
});

module.exports = router;
