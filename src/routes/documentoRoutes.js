const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { SolicitudDocumento, sequelize } = require('../models');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const {
  UPLOADS_ROOT,
  getDocumentStorageState,
  normalizeUploadPath,
  resolveAbsoluteUploadPath
} = require('../utils/documentStorage');

const buildDocumentUrl = (req, documentoId, disposition = 'inline') =>
  `${req.protocol}://${req.get('host')}/api/documentos/${documentoId}/download?disposition=${disposition}`;

const buscarDocumentoGenericoPorId = async (id) => {
  const solicitudDocs = await sequelize.query(
    `
      SELECT
        id,
        ruta,
        nombre_original AS nombre,
        nombre_original,
        mime_type,
        tipo_documento,
        size_bytes,
        creado_en,
        'SOLICITUD' AS source_type
      FROM public.solicitud_documentos
      WHERE id = :id
      LIMIT 1
    `,
    {
      replacements: { id },
      type: sequelize.QueryTypes.SELECT
    }
  );

  if (Array.isArray(solicitudDocs) && solicitudDocs.length > 0) {
    return solicitudDocs[0];
  }

  const clienteDocs = await sequelize.query(
    `
      SELECT
        id,
        ruta,
        nombre,
        nombre AS nombre_original,
        mime_type,
        tipo AS tipo_documento,
        size_bytes,
        creado_en,
        'CLIENTE' AS source_type
      FROM public.cliente_documentos
      WHERE id = :id
      LIMIT 1
    `,
    {
      replacements: { id },
      type: sequelize.QueryTypes.SELECT
    }
  );

  if (Array.isArray(clienteDocs) && clienteDocs.length > 0) {
    return clienteDocs[0];
  }

  return null;
};

router.get('/:id/url', authenticateToken, requirePermission('documentos.view'), async (req, res) => {
  try {
    const { id } = req.params;
    const documento = await buscarDocumentoGenericoPorId(id);

    if (!documento) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const rutaNormalizada = normalizeUploadPath(documento.ruta);
    const availability = getDocumentStorageState(rutaNormalizada);

    return res.json({
      success: true,
      data: {
        id: documento.id,
        tipo: documento.tipo_documento || null,
        source_type: documento.source_type,
        exists: availability.exists,
        archivo_disponible: availability.exists,
        storage_path: availability.relativePath,
        storage_key: availability.relativePath,
        url: availability.exists ? buildDocumentUrl(req, documento.id, 'inline') : null,
        url_descarga: availability.exists ? buildDocumentUrl(req, documento.id, 'attachment') : null
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

router.get('/:id/download', authenticateToken, requirePermission('documentos.view'), async (req, res) => {
  try {
    const { id } = req.params;
    const { disposition = 'inline' } = req.query;

    const documento = await buscarDocumentoGenericoPorId(id);
    if (!documento) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const rutaNormalizada = normalizeUploadPath(documento.ruta);
    const availability = getDocumentStorageState(rutaNormalizada);
    const rutaAbsoluta = availability.absolutePath || resolveAbsoluteUploadPath(rutaNormalizada);

    if (!availability.valid || !rutaAbsoluta.startsWith(UPLOADS_ROOT)) {
      return res.status(400).json({
        success: false,
        message: 'Ruta de documento inválida'
      });
    }

    if (!availability.exists) {
      return res.status(404).json({
        success: false,
        exists: false,
        archivo_disponible: false,
        storage_path: availability.relativePath,
        message: (documento.tipo_documento || '').toUpperCase() === 'CONTRATO_CREDITO'
          ? 'Contrato no disponible en almacenamiento'
          : 'Archivo no disponible en el servidor'
      });
    }

    const contentDisposition = disposition === 'attachment' ? 'attachment' : 'inline';
    const safeFileName = String(documento.nombre_original || documento.nombre || 'documento.pdf').replace(/"/g, '');
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
  requirePermission('documentos.delete'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const documento = await buscarDocumentoGenericoPorId(id);
      if (!documento) {
        return res.status(404).json({
          success: false,
          message: 'Documento no encontrado'
        });
      }

      const rutaNormalizada = normalizeUploadPath(documento.ruta);
      const availability = getDocumentStorageState(rutaNormalizada);
      const rutaAbsoluta = availability.absolutePath || resolveAbsoluteUploadPath(rutaNormalizada);

      if (availability.valid && rutaAbsoluta.startsWith(UPLOADS_ROOT) && availability.exists) {
        await fs.promises.unlink(rutaAbsoluta).catch(() => null);
      }

      if (documento.source_type === 'CLIENTE') {
        await sequelize.query(
          'DELETE FROM public.cliente_documentos WHERE id = :id',
          {
            replacements: { id },
            type: sequelize.QueryTypes.DELETE
          }
        );
      } else {
        const solicitudDocumento = await SolicitudDocumento.findByPk(id);
        if (solicitudDocumento) {
          await solicitudDocumento.destroy();
        }
      }

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
