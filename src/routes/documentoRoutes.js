const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { SolicitudDocumento } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

const buildDocumentUrl = (req, documentoId, disposition = 'inline') =>
  `${req.protocol}://${req.get('host')}/api/documentos/${documentoId}/download?disposition=${disposition}`;

router.get('/:id/url', async (req, res) => {
  try {
    const { id } = req.params;
    const documento = await SolicitudDocumento.findByPk(id);

    if (!documento) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    return res.json({
      success: true,
      data: {
        id: documento.id,
        tipo: documento.tipo_documento || null,
        url: buildDocumentUrl(req, documento.id, 'inline'),
        url_descarga: buildDocumentUrl(req, documento.id, 'attachment')
      }
    });
  } catch (error) {
    console.error('Error obteniendo URL de documento:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener URL del documento'
    });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const { disposition = 'inline' } = req.query;

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
        message: (documento.tipo_documento || '').toUpperCase() === 'CONTRATO_CREDITO'
          ? 'Contrato no disponible en almacenamiento'
          : 'Archivo no disponible en el servidor'
      });
    }

    const contentDisposition = disposition === 'attachment' ? 'attachment' : 'inline';
    const safeFileName = String(documento.nombre_original || 'documento.pdf').replace(/"/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${contentDisposition}; filename="${safeFileName}"`);
    console.log(`📄 Documento ${id} servido (${contentDisposition}) por usuario ${req.user?.id || 'N/A'}`);
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
      console.log(`🗑️ Documento ${id} eliminado por usuario ${req.user?.id || 'N/A'}`);

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
