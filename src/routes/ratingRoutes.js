// src/routes/ratingRoutes.js - VERSIÓN CORREGIDA Y COMPLETA
const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../middleware/auth');

console.log('🔄 Cargando ratingRoutes.js...');

// Intentar importar el controller
let ratingController;
try {
    ratingController = require('../controllers/ratingController');
    console.log('✅ ratingController importado correctamente');
    
    // Verificar que los métodos existen
    if (!ratingController.testRatingSystem) {
        console.warn('⚠️  testRatingSystem no encontrado en controller');
    }
    if (!ratingController.getClientRating) {
        console.warn('⚠️  getClientRating no encontrado en controller');
    }
    if (!ratingController.getAllClientsRanking) {
        console.warn('⚠️  getAllClientsRanking no encontrado en controller');
    }
    
} catch (error) {
    console.error('❌ Error importando ratingController:', error.message);
    
    // Crear un controller de emergencia
    ratingController = {
        testRatingSystem: (req, res) => {
            res.json({
                success: false,
                message: 'Controller no disponible',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        },
        getClientRating: (req, res) => {
            res.json({
                success: false,
                message: 'Controller no disponible',
                nombre: req.params.nombre
            });
        },
        getAllClientsRanking: (req, res) => {
            res.json({
                success: false,
                message: 'Controller no disponible'
            });
        },
        // Métodos opcionales que pueden no existir
        getLoanAnalysis: undefined,
        getClientsByRating: undefined,
        getPortfolioRiskReport: undefined
    };
}

// Configurar solo las rutas que existen
console.log('🔧 Configurando rutas disponibles...');

// 1. Ruta de prueba (SIEMPRE debe existir)
router.get('/test', authenticateToken, requirePermission('ratings.run'), (req, res) => {
    console.log('📞 Llamada a /api/ratings/test');
    if (ratingController.testRatingSystem) {
        return ratingController.testRatingSystem(req, res);
    }
    res.json({
        success: false,
        message: 'testRatingSystem no disponible'
    });
});

// 2. Calificación de cliente
router.get('/client/:nombre', authenticateToken, requirePermission('ratings.run'), (req, res) => {
    console.log(`📞 Llamada a /api/ratings/client/${req.params.nombre}`);
    if (ratingController.getClientRating) {
        return ratingController.getClientRating(req, res);
    }
    res.json({
        success: false,
        message: 'getClientRating no disponible'
    });
});

// 3. Ranking de clientes
router.get('/ranking', authenticateToken, requirePermission('ratings.run'), (req, res) => {
    console.log('📞 Llamada a /api/ratings/ranking');
    if (ratingController.getAllClientsRanking) {
        return ratingController.getAllClientsRanking(req, res);
    }
    res.json({
        success: false,
        message: 'getAllClientsRanking no disponible'
    });
});

// 4. Ruta raíz de ratings
router.get('/', authenticateToken, requirePermission('ratings.run'), (req, res) => {
    console.log('📞 Llamada a /api/ratings/');
    res.json({
        success: true,
        service: 'Crediflash Rating System',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            test: 'GET /api/ratings/test',
            clientRating: 'GET /api/ratings/client/{nombre}',
            allRankings: 'GET /api/ratings/ranking?limit=50'
        },
        status: 'operational'
    });
});

// NOTA: Las rutas que no existen en el controller NO se configuran
// getLoanAnalysis, getClientsByRating, etc. se omiten por ahora

console.log('✅ ratingRoutes.js configurado correctamente');

module.exports = router;
