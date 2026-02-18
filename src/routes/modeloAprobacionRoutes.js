const express = require('express');
const router = express.Router();
const modeloAprobacionController = require('../controllers/modeloAprobacionController');

// Rutas para modelos de aprobación
router.get('/', modeloAprobacionController.getAll);
router.get('/:id', modeloAprobacionController.getById);
router.post('/', modeloAprobacionController.create);
router.put('/:id', modeloAprobacionController.update);
router.delete('/:id', modeloAprobacionController.delete);

module.exports = router; // ✅ Solo exportar, no llamar