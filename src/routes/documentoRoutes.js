const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { SolicitudDocumento } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

router.get('/:documentoId/download', authenticateToken, async (req, res) => {
  try {
    const { documentoId } = req.params;

    const documento = await SolicitudDocumento.findByPk(documentoId);
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

    res.setHeader('Content-Type', documento.mime_type || 'application/pdf');
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

module.exports = router;
