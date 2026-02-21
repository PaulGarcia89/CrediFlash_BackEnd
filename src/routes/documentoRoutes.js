const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { SolicitudDocumento } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

router.get('/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const documento = await SolicitudDocumento.findByPk(id);
    if (!documento) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const rutaNormalizada = String(documento.ruta || '').replace(/\\/g, '/');
    const rutaAbsoluta = path.resolve(PROJECT_ROOT, rutaNormalizada);
    const uploadsRoot = path.resolve(PROJECT_ROOT, 'uploads');

    if (!rutaAbsoluta.startsWith(uploadsRoot)) {
      return res.status(400).json({
        success: false,
        message: 'Ruta de documento inválida'
      });
    }

    if (!fs.existsSync(rutaAbsoluta)) {
      return res.status(404).json({
        success: false,
        message: 'Archivo no disponible en el servidor'
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${documento.nombre_original}"`);
    return res.sendFile(rutaAbsoluta);
  } catch (error) {
    console.error('Error descargando documento:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al descargar el documento'
    });
  }
});

router.delete(
  '/:id',
  authenticateToken,
  requireRole('ANALISTA', 'SUPERVISOR', 'ADMINISTRADOR'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const documento = await SolicitudDocumento.findByPk(id);
      if (!documento) {
        return res.status(404).json({
          success: false,
          message: 'Documento no encontrado'
        });
      }

      const rutaNormalizada = String(documento.ruta || '').replace(/\\/g, '/');
      const rutaAbsoluta = path.resolve(PROJECT_ROOT, rutaNormalizada);
      const uploadsRoot = path.resolve(PROJECT_ROOT, 'uploads');

      if (rutaAbsoluta.startsWith(uploadsRoot) && fs.existsSync(rutaAbsoluta)) {
        await fs.promises.unlink(rutaAbsoluta).catch(() => null);
      }

      await documento.destroy();

      return res.json({
        success: true,
        message: 'Documento eliminado correctamente'
      });
    } catch (error) {
      console.error('Error eliminando documento:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al eliminar el documento'
      });
    }
  }
);

module.exports = router;
