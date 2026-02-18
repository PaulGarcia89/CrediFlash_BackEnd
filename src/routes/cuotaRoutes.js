// src/routes/cuotaRoutes.js
const express = require('express');
const router = express.Router();
const cuotaController = require('../controllers/cuotaController');

// ========== RUTAS PRINCIPALES ==========

// Obtener todas las cuotas
router.get('/', cuotaController.getAllCuotas);

// Obtener cuota por ID
router.get('/:id', cuotaController.getCuotaById);

// Obtener cuotas por préstamo
router.get('/prestamo/:prestamoId', cuotaController.getCuotasByPrestamo);

// Crear nueva cuota
router.post('/', cuotaController.createCuota);

// Actualizar cuota
router.put('/:id', cuotaController.updateCuota);

// Registrar pago de cuota
router.post('/:id/pago', cuotaController.registrarPago);

// Eliminar cuota
router.delete('/:id', cuotaController.deleteCuota);

// ========== RUTAS ESPECIALES ==========

// Generar cuotas para préstamo
router.post('/prestamo/:prestamoId/generar', cuotaController.generarCuotasParaPrestamo);
// Generar cuotas semanales para préstamo
router.post('/prestamo/:prestamoId/generar-semanales', cuotaController.generarCuotasSemanalesParaPrestamo);
// Generar cuotas semanales para todos los préstamos
router.post('/prestamos/generar-semanales', cuotaController.generarCuotasSemanalesParaTodos);

// Obtener cuotas vencidas
router.get('/reportes/vencidas', cuotaController.getCuotasVencidas);

// Obtener estadísticas
router.get('/estadisticas/resumen', cuotaController.getEstadisticasCuotas);

// Ruta de prueba
router.get('/test/conexion', async (req, res) => {
  try {
    const { sequelize } = require('../models');
    
    // Verificar conexión a la base de datos
    await sequelize.authenticate();
    
    // Verificar tabla cuotas
    const [result] = await sequelize.query(`
      SELECT COUNT(*) as total_cuotas FROM cuotas
    `);
    
    res.json({
      success: true,
      message: '✅ Sistema de cuotas funcionando correctamente',
      database: 'conectada',
      total_cuotas: result[0].total_cuotas || 0,
      estructura_correcta: true
    });
  } catch (error) {
    console.error('❌ Error en test de conexión:', error);
    res.status(500).json({
      success: false,
      message: 'Error en sistema de cuotas',
      error: error.message
    });
  }
});

module.exports = router;
