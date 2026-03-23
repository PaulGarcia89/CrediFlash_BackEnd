// src/routes/cuotaRoutes.js
const express = require('express');
const router = express.Router();
const cuotaController = require('../controllers/cuotaController');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const withNotificationAuditContext = (canal) => (req, res, next) => {
  const isPrestamoRoute = Boolean(req.params?.prestamoId);
  res.locals.audit_action = canal === 'WHATSAPP'
    ? 'NOTIFICAR_WHATSAPP_MANUAL'
    : 'NOTIFICAR_EMAIL_MANUAL';
  res.locals.audit_metadata = {
    accion: res.locals.audit_action,
    canal,
    prestamo_id: isPrestamoRoute ? req.params?.prestamoId : null,
    cuota_id: req.params?.id || null
  };
  next();
};

const validateJobToken = (req, res, next) => {
  const configuredToken = process.env.NOTIFICATIONS_JOB_TOKEN;
  const receivedToken = req.headers['x-job-token'];

  if (!configuredToken) {
    return res.status(500).json({
      success: false,
      message: 'NOTIFICATIONS_JOB_TOKEN no está configurado'
    });
  }

  if (!receivedToken || receivedToken !== configuredToken) {
    return res.status(401).json({
      success: false,
      message: 'Token de job inválido'
    });
  }

  return next();
};

// ========== RUTAS PRINCIPALES ==========

// Obtener todas las cuotas
router.get('/', authenticateToken, requirePermission('cuotas.view'), cuotaController.getAllCuotas);

// Obtener cuota por ID
router.get('/:id', authenticateToken, requirePermission('cuotas.view'), cuotaController.getCuotaById);

// Obtener cuotas por préstamo
router.get('/prestamo/:prestamoId', authenticateToken, requirePermission('cuotas.view'), cuotaController.getCuotasByPrestamo);

// Crear nueva cuota
router.post('/', authenticateToken, requirePermission('cuotas.manage'), cuotaController.createCuota);

// Actualizar cuota
router.put('/:id', authenticateToken, requirePermission('cuotas.manage'), cuotaController.updateCuota);

// Registrar pago de cuota
router.post('/:id/pago', authenticateToken, requirePermission('prestamos.pay'), cuotaController.registrarPago);

// Eliminar cuota
router.delete('/:id', authenticateToken, requirePermission('cuotas.manage'), cuotaController.deleteCuota);

// ========== RUTAS ESPECIALES ==========

// Generar cuotas para préstamo
router.post('/prestamo/:prestamoId/generar', authenticateToken, requirePermission('cuotas.manage'), cuotaController.generarCuotasParaPrestamo);
// Generar cuotas semanales para préstamo
router.post('/prestamo/:prestamoId/generar-semanales', authenticateToken, requirePermission('cuotas.manage'), cuotaController.generarCuotasSemanalesParaPrestamo);
// Generar cuotas semanales para todos los préstamos
router.post('/prestamos/generar-semanales', authenticateToken, requirePermission('cuotas.manage'), cuotaController.generarCuotasSemanalesParaTodos);

// Notificación manual por correo para una cuota
router.post(
  '/:id/notificar-email',
  withNotificationAuditContext('EMAIL'),
  authenticateToken,
  requirePermission('notifications.send'),
  cuotaController.enviarNotificacionEmailManual
);
router.post(
  '/prestamo/:prestamoId/notificar-email',
  withNotificationAuditContext('EMAIL'),
  authenticateToken,
  requirePermission('notifications.send'),
  cuotaController.enviarNotificacionEmailManualPorPrestamo
);
router.post(
  '/prestamo/:prestamoId/notificar-whatsapp',
  withNotificationAuditContext('WHATSAPP'),
  authenticateToken,
  requirePermission('notifications.send'),
  cuotaController.enviarNotificacionWhatsAppManualPorPrestamo
);

// Job de notificaciones automáticas 24h (se recomienda invocar por cron)
router.post(
  '/jobs/notificar-email-24h',
  validateJobToken,
  cuotaController.enviarNotificacionesEmailAutomaticas24h
);

// Obtener cuotas vencidas
router.get('/reportes/vencidas', authenticateToken, requirePermission('cuotas.view'), cuotaController.getCuotasVencidas);

// Obtener estadísticas
router.get('/estadisticas/resumen', authenticateToken, requirePermission('cuotas.view'), cuotaController.getEstadisticasCuotas);

// Ruta de prueba
router.get('/test/conexion', authenticateToken, requirePermission('cuotas.view'), async (req, res) => {
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
