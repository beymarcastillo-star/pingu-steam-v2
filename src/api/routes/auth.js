const router = require('express').Router();

router.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.PANEL_PASSWORD) {
        res.json({ ok: true });
    } else {
        res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
    }
});

router.get('/logout', (req, res) => {
    res.redirect('/login.html');
});

module.exports = router;
