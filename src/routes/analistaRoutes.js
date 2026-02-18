// src/routes/analistaRoutes.js - RUTAS REALES
const express = require('express');
const router = express.Router();
const analistaController = require('../controllers/analistaController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// ========== RUTAS PÚBLICAS ==========
router.post('/registrar', analistaController.registrarAnalista);
router.post('/login', analistaController.login);

// ========== RUTAS PROTEGIDAS (requieren token) ==========
router.get('/perfil', authenticateToken, analistaController.getPerfil);
router.put('/perfil', authenticateToken, analistaController.updatePerfil);

// ========== RUTAS PARA ADMIN/SUPERVISOR ==========
router.get('/', authenticateToken, requireRole('ADMINISTRADOR', 'SUPERVISOR'), analistaController.listarAnalistas);
router.get('/:id', authenticateToken, requireRole('ADMINISTRADOR', 'SUPERVISOR'), analistaController.getAnalistaById);

// ========== RUTAS SOLO PARA ADMIN ==========
router.put('/:id', authenticateToken, requireRole('ADMINISTRADOR'), analistaController.updateAnalista);
router.delete('/:id', authenticateToken, requireRole('ADMINISTRADOR'), analistaController.deleteAnalista);

module.exports = router;