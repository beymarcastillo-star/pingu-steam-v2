const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

function storage(subcarpeta) {
    return multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, '../../../public/img', subcarpeta || '');
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    });
}

// Subir imagen de servicio / QR
router.post('/upload', (req, res) => {
    const carpeta = req.query.carpeta || req.body?.carpeta || '';
    const upload  = multer({ storage: storage(carpeta) }).single('file');
    upload(req, res, (err) => {
        if (err || !req.file) return res.status(400).json({ error: 'Error subiendo archivo' });
        res.json({ ok: true, filename: req.file.filename });
    });
});

// Subir logo
router.post('/logo', (req, res) => {
    const upload = multer({ storage: storage('') }).single('file');
    upload(req, res, (err) => {
        if (err || !req.file) return res.status(400).json({ error: 'Error subiendo logo' });
        res.json({ ok: true, filename: req.file.filename });
    });
});

module.exports = router;
