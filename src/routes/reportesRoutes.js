const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { Op } = require('sequelize');
const crypto = require('crypto');
const { PagoBancarioCargado } = require('../models');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const reportesController = require('../controllers/reportesController');
const { formatMMDDYYYY } = require('../utils/dateFormat');

const router = express.Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const HEADER_ALIASES = {
  nombre_completo: new Set(['nombrecompleto', 'nombrescompleto']),
  monto: new Set(['monto']),
  fecha: new Set(['fecha'])
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

const normalizeHeader = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const parseMoney = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { ok: false, value: null };
  }

  const normalized = String(value).replace(/,/g, '.').replace(/[^0-9.-]/g, '');
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { ok: false, value: null };
  }

  return { ok: true, value: Number(numeric.toFixed(2)) };
};

const toIsoDate = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const month = String(parsed.m).padStart(2, '0');
    const day = String(parsed.d).padStart(2, '0');
    return `${parsed.y}-${month}-${day}`;
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return text;

  const mmddyyyyMatch = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (mmddyyyyMatch) {
    const [, mm, dd, yyyy] = mmddyyyyMatch;
    return `${yyyy}-${mm}-${dd}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isAllowedFile = (filename = '') => {
  const lower = filename.toLowerCase();
  return Array.from(ALLOWED_EXTENSIONS).some((ext) => lower.endsWith(ext));
};

const findColumnKey = (headers = [], aliases = new Set()) =>
  headers.find((header) => aliases.has(normalizeHeader(header))) || null;

const parseWorkbookRows = (buffer) => {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellDates: false });
  const firstSheetName = workbook.SheetNames?.[0];
  if (!firstSheetName) {
    throw new Error('El archivo está vacío');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  return rows;
};

const rowIsEmpty = (row = {}) => Object.values(row).every((value) => String(value ?? '').trim() === '');

const parseDateFilter = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

const serializePagoBancario = (item) => {
  const payload = item.toJSON ? item.toJSON() : item;
  return {
    ...payload,
    fecha_pago: formatMMDDYYYY(payload.fecha_pago),
    creado_en: formatMMDDYYYY(payload.creado_en),
    actualizado_en: formatMMDDYYYY(payload.actualizado_en)
  };
};

router.post(
  '/pagos-bancarios/cargar',
  authenticateToken,
  requirePermission('reportes.manage'),
  (req, res, next) => {
    upload.single('archivo')(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          success: false,
          message: error.code === 'LIMIT_FILE_SIZE'
            ? 'El archivo supera el tamaño máximo permitido (10MB)'
            : 'Archivo inválido'
        });
      }
      return next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Debe cargar un archivo .xlsx, .xls o .csv'
        });
      }

      if (!isAllowedFile(req.file.originalname)) {
        return res.status(400).json({
          success: false,
          message: 'Formato inválido. Solo se permiten archivos .xlsx, .xls o .csv'
        });
      }

      const rows = parseWorkbookRows(req.file.buffer);
      if (!rows.length) {
        return res.status(400).json({
          success: false,
          message: 'El archivo no contiene filas para procesar'
        });
      }

      const headers = Object.keys(rows[0] || {});
      const nombreColumn = findColumnKey(headers, HEADER_ALIASES.nombre_completo);
      const montoColumn = findColumnKey(headers, HEADER_ALIASES.monto);
      const fechaColumn = findColumnKey(headers, HEADER_ALIASES.fecha);

      if (!nombreColumn || !montoColumn || !fechaColumn) {
        return res.status(400).json({
          success: false,
          message: 'El archivo debe incluir columnas: Nombres Completo, monto y fecha'
        });
      }

      const loteId = crypto.randomUUID();

      let totalFilas = 0;
      let guardadas = 0;
      let invalidas = 0;
      let duplicadas = 0;
      const registros = [];
      const duplicateLocalSet = new Set();

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (rowIsEmpty(row)) continue;

        totalFilas += 1;
        const filaOrigen = index + 2;
        const nombreCompleto = String(row[nombreColumn] || '').trim();
        const montoParsed = parseMoney(row[montoColumn]);
        const fechaIso = toIsoDate(row[fechaColumn]);

        let estado = 'VALIDO';
        let observacion = null;

        if (!nombreCompleto) {
          estado = 'INVALIDO';
          observacion = 'Nombre completo vacío';
        } else if (!montoParsed.ok) {
          estado = 'INVALIDO';
          observacion = 'Monto inválido. Debe ser un número mayor o igual a 0';
        } else if (!fechaIso) {
          estado = 'INVALIDO';
          observacion = 'Fecha inválida. Use formato MM/DD/YYYY o YYYY-MM-DD';
        }

        const montoNumerico = montoParsed.ok ? montoParsed.value : 0;
        const duplicateKey = `${nombreCompleto.toLowerCase()}|${montoNumerico.toFixed(2)}|${fechaIso}`;
        if (estado === 'VALIDO' && duplicateLocalSet.has(duplicateKey)) {
          estado = 'DUPLICADO';
          observacion = 'Registro duplicado dentro del mismo archivo';
        }

        if (estado === 'VALIDO') {
          duplicateLocalSet.add(duplicateKey);
          const alreadyExists = await PagoBancarioCargado.findOne({
            where: {
              nombre_completo: { [Op.iLike]: nombreCompleto },
              monto: montoNumerico,
              fecha_pago: fechaIso
            },
            attributes: ['id']
          });

          if (alreadyExists) {
            estado = 'DUPLICADO';
            observacion = 'Registro ya existe previamente';
          }
        }

        if (estado === 'VALIDO') guardadas += 1;
        if (estado === 'INVALIDO') invalidas += 1;
        if (estado === 'DUPLICADO') duplicadas += 1;

        registros.push({
          lote_id: loteId,
          nombre_completo: nombreCompleto || 'SIN_NOMBRE',
          monto: montoNumerico,
          fecha_pago: fechaIso || new Date().toISOString().slice(0, 10),
          archivo_nombre: req.file.originalname,
          fila_origen: filaOrigen,
          estado,
          observacion,
          creado_por_analista_id: req.user.id,
          creado_en: new Date(),
          actualizado_en: new Date()
        });
      }

      if (!registros.length) {
        return res.status(400).json({
          success: false,
          message: 'El archivo no contiene filas válidas para procesar'
        });
      }

      await PagoBancarioCargado.bulkCreate(registros);

      res.locals.audit_metadata = {
        evento: 'CARGA_PAGOS_BANCARIOS',
        lote_id: loteId,
        archivo_nombre: req.file.originalname,
        total_filas: totalFilas,
        guardadas,
        invalidas,
        duplicadas
      };

      return res.status(200).json({
        success: true,
        message: 'Archivo procesado correctamente',
        data: {
          lote_id: loteId,
          archivo_nombre: req.file.originalname,
          total_filas: totalFilas,
          guardadas,
          invalidas,
          duplicadas
        }
      });
    } catch (error) {
      console.error('Error cargando pagos bancarios:', error);
      return res.status(500).json({
        success: false,
        message: 'Error interno procesando el archivo'
      });
    }
  }
);

router.get(
  '/pagos-bancarios',
  authenticateToken,
  requirePermission('reportes.view'),
  async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page || '1', 10), 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
      const offset = (page - 1) * limit;
      const where = {};

      if (req.query.search) {
        where.nombre_completo = { [Op.iLike]: `%${req.query.search}%` };
      }
      if (req.query.lote_id) {
        where.lote_id = req.query.lote_id;
      }
      if (req.query.estado) {
        where.estado = String(req.query.estado).toUpperCase();
      }

      const fechaDesde = parseDateFilter(req.query.fecha_desde);
      const fechaHasta = parseDateFilter(req.query.fecha_hasta, true);
      if (fechaDesde || fechaHasta) {
        where.fecha_pago = {};
        if (fechaDesde) where.fecha_pago[Op.gte] = fechaDesde.toISOString().slice(0, 10);
        if (fechaHasta) where.fecha_pago[Op.lte] = fechaHasta.toISOString().slice(0, 10);
      }

      const { count, rows } = await PagoBancarioCargado.findAndCountAll({
        where,
        order: [['creado_en', 'DESC']],
        limit,
        offset
      });

      return res.json({
        success: true,
        data: rows.map(serializePagoBancario),
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit)
        }
      });
    } catch (error) {
      console.error('Error listando pagos bancarios cargados:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo pagos bancarios cargados'
      });
    }
  }
);

router.get(
  '/pagos-bancarios/lote/:loteId',
  authenticateToken,
  requirePermission('reportes.view'),
  async (req, res) => {
    try {
      const { loteId } = req.params;
      const rows = await PagoBancarioCargado.findAll({
        where: { lote_id: loteId },
        order: [['fila_origen', 'ASC']]
      });

      const resumen = rows.reduce(
        (acc, item) => {
          const estado = String(item.estado || 'VALIDO').toUpperCase();
          if (estado === 'VALIDO') acc.validas += 1;
          if (estado === 'INVALIDO') acc.invalidas += 1;
          if (estado === 'DUPLICADO') acc.duplicadas += 1;
          if (estado === 'PROCESADO') acc.procesadas += 1;
          return acc;
        },
        { total: rows.length, validas: 0, invalidas: 0, duplicadas: 0, procesadas: 0 }
      );

      return res.json({
        success: true,
        data: rows.map(serializePagoBancario),
        resumen
      });
    } catch (error) {
      console.error('Error obteniendo lote de pagos bancarios:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo lote de pagos bancarios'
      });
    }
  }
);

router.get(
  '/generar',
  authenticateToken,
  requirePermission('reportes.view'),
  reportesController.generar
);

router.get(
  '/kpis/resumen',
  authenticateToken,
  requirePermission('reportes.view'),
  reportesController.kpisResumen
);

router.get(
  '/export',
  authenticateToken,
  requirePermission('reportes.manage'),
  reportesController.exportar
);

router.get(
  '/cuotas-pendientes-correo-admin',
  authenticateToken,
  requirePermission('reportes.manage'),
  reportesController.cuotasPendientesCorreoAdmin
);

router.get(
  '/:tipo',
  authenticateToken,
  requirePermission('reportes.view'),
  (req, _res, next) => {
    req.query.tipo = req.params.tipo;
    next();
  },
  reportesController.generar
);

module.exports = router;
