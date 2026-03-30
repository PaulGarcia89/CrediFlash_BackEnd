const { Op, QueryTypes } = require('sequelize');
const XLSX = require('xlsx');
const { sequelize, Cuota, Prestamo, Solicitud, Cliente, Analista } = require('../models');
const { sendMailWithReportCsv } = require('../utils/emailNotificationService');

const TIMEZONE = 'America/New_York';
const VERSION = 'v1';

const TIPOS_REPORTE = new Set([
  'pipeline-comercial',
  'cartera-activa',
  'ganancias-esperadas-cobradas',
  'saldo-pendiente-cliente',
  'moras-historial-pagos',
  'top-moras-diarias',
  'productividad-analistas',
  'notificaciones-envios',
  'referidos-impacto',
  // compatibilidad histórica:
  'ano-contra-ano',
  'metas'
]);

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const round2 = (value) => Number(toNumber(value).toFixed(2));

const formatMMDDYYYY = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
};

const toYmdString = (date) => {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseDateStrict = (value) => {
  if (!value) return null;
  const text = String(value).trim();

  const mmdd = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mmdd) {
    const [, mm, dd, yyyy] = mmdd;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const [, yyyy, mm, dd] = ymd;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const buildDateRange = ({ fecha_inicio, fecha_fin }) => {
  const start = parseDateStrict(fecha_inicio);
  const end = parseDateStrict(fecha_fin);

  if (!start || !end) {
    const error = new Error('Parámetros de fechas inválidos. Formato requerido MM/DD/YYYY');
    error.error_code = 'REPORT_DATE_INVALID';
    throw error;
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (start > end) {
    const error = new Error('fecha_inicio no puede ser mayor que fecha_fin');
    error.error_code = 'REPORT_DATE_RANGE_INVALID';
    throw error;
  }

  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 731) {
    const error = new Error('El rango máximo permitido es de 24 meses');
    error.error_code = 'REPORT_DATE_RANGE_TOO_LARGE';
    throw error;
  }

  const startYmd = toYmdString(start);
  const endYmd = toYmdString(end);
  return {
    start,
    end,
    startYmd,
    endYmd,
    startTs: `${startYmd} 00:00:00`,
    endTs: `${endYmd} 23:59:59.999`
  };
};

const withPagination = (rows = [], page = 1, limit = 20) => {
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const currentLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
  const offset = (currentPage - 1) * currentLimit;
  return {
    rows: rows.slice(offset, offset + currentLimit),
    pagination: {
      page: currentPage,
      limit: currentLimit,
      total: rows.length,
      pages: Math.max(Math.ceil(rows.length / currentLimit), 1)
    }
  };
};

const cuotaInteresCobrado = (cuota) => {
  const montoTotal = toNumber(cuota.monto_total);
  const montoInteres = toNumber(cuota.monto_interes);
  const montoPagado = toNumber(cuota.monto_pagado);
  if (montoTotal <= 0 || montoInteres <= 0 || montoPagado <= 0) return 0;
  return round2(montoPagado * (montoInteres / montoTotal));
};

const calculateMora = (cuota, today) => {
  const fechaVencimiento = parseDateStrict(cuota.fecha_vencimiento) || new Date(cuota.fecha_vencimiento);
  if (!fechaVencimiento || Number.isNaN(fechaVencimiento.getTime())) return null;

  const montoTotal = toNumber(cuota.monto_total);
  const montoPagado = toNumber(cuota.monto_pagado);
  const saldo = round2(Math.max(montoTotal - montoPagado, 0));
  if (saldo <= 0) return null;

  const fechaPago = cuota.fecha_pago ? new Date(cuota.fecha_pago) : null;
  if (fechaPago && fechaPago > fechaVencimiento) {
    const dias = Math.ceil((fechaPago.getTime() - fechaVencimiento.getTime()) / (1000 * 60 * 60 * 24));
    return { dias, estado: 'MORA_PAGADA', saldo };
  }

  if (!fechaPago && today > fechaVencimiento) {
    const dias = Math.ceil((today.getTime() - fechaVencimiento.getTime()) / (1000 * 60 * 60 * 24));
    return { dias, estado: 'EN_MORA', saldo };
  }

  return null;
};

const getBaseCuotaIncludes = () => ([
  {
    model: Prestamo,
    as: 'prestamo',
    attributes: ['id', 'monto_solicitado', 'total_pagar', 'pendiente', 'pagos_semanales', 'status'],
    include: [
      {
        model: Solicitud,
        as: 'solicitud',
        attributes: ['id', 'cliente_id'],
        include: [
          {
            model: Cliente,
            as: 'cliente',
            attributes: ['id', 'nombre', 'apellido', 'email']
          }
        ]
      }
    ]
  }
]);

const ensureReportTables = async () => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS public.auditoria_eventos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_analista_id uuid NULL,
      actor_email varchar(200) NULL,
      accion varchar(150) NOT NULL,
      modulo varchar(100) NOT NULL,
      entidad varchar(100) NULL,
      entidad_id varchar(120) NULL,
      payload_json jsonb NULL,
      resultado varchar(20) NULL DEFAULT 'OK',
      error_mensaje text NULL,
      origen varchar(50) NOT NULL DEFAULT 'API',
      created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS public.notificaciones_envios (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      canal varchar(20) NOT NULL,
      tipo varchar(50) NOT NULL,
      cliente_id uuid NULL,
      prestamo_id uuid NULL,
      cuota_id uuid NULL,
      destinatario varchar(255) NOT NULL,
      estado varchar(20) NOT NULL DEFAULT 'PENDIENTE',
      provider_message_id varchar(255) NULL,
      error text NULL,
      actor_analista_id uuid NULL,
      created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_created_at ON public.auditoria_eventos (created_at DESC)');
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_actor ON public.auditoria_eventos (actor_analista_id)');
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_modulo ON public.auditoria_eventos (modulo)');
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_notificaciones_envios_created_at ON public.notificaciones_envios (created_at DESC)');
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_notificaciones_envios_canal_estado ON public.notificaciones_envios (canal, estado)');
};

const registrarAuditoriaEvento = async ({
  user,
  accion,
  modulo,
  entidad = null,
  entidad_id = null,
  payload = null,
  resultado = 'OK',
  error_mensaje = null
}) => {
  try {
    await ensureReportTables();
    await sequelize.query(
      `INSERT INTO public.auditoria_eventos
      (actor_analista_id, actor_email, accion, modulo, entidad, entidad_id, payload_json, resultado, error_mensaje, origen, created_at)
      VALUES (:actor_analista_id, :actor_email, :accion, :modulo, :entidad, :entidad_id, CAST(:payload_json AS jsonb), :resultado, :error_mensaje, 'API', NOW())`,
      {
        replacements: {
          actor_analista_id: user?.id || null,
          actor_email: user?.email || null,
          accion,
          modulo,
          entidad,
          entidad_id,
          payload_json: JSON.stringify(payload || {}),
          resultado,
          error_mensaje
        }
      }
    );
  } catch (_error) {
    // No romper flujo principal
  }
};

const generarPipelineComercial = async ({ startTs, endTs, filtros }) => {
  const where = { creado_en: { [Op.between]: [startTs, endTs] } };
  if (filtros.analista_id) where.analista_id = filtros.analista_id;
  if (filtros.modalidad) where.modalidad = String(filtros.modalidad).toUpperCase();

  const solicitudes = await Solicitud.findAll({ where, attributes: ['id', 'estado'] });
  const creadas = solicitudes.length;
  const aprobadas = solicitudes.filter((x) => x.estado === 'APROBADO').length;
  const rechazadas = solicitudes.filter((x) => x.estado === 'RECHAZADO').length;
  const tasa = creadas > 0 ? round2((aprobadas / creadas) * 100) : 0;

  return {
    tipo: 'pipeline-comercial',
    columns: [
      { id: 'solicitudes_creadas', label: 'Solicitudes creadas', type: 'number' },
      { id: 'solicitudes_aprobadas', label: 'Solicitudes aprobadas', type: 'number' },
      { id: 'solicitudes_rechazadas', label: 'Solicitudes rechazadas', type: 'number' },
      { id: 'tasa_conversion', label: 'Tasa conversión', type: 'number' }
    ],
    rows: [
      {
        solicitudes_creadas: creadas,
        solicitudes_aprobadas: aprobadas,
        solicitudes_rechazadas: rechazadas,
        tasa_conversion: tasa
      }
    ],
    resumen: {
      solicitudes_creadas: creadas,
      solicitudes_aprobadas: aprobadas,
      solicitudes_rechazadas: rechazadas,
      tasa_conversion: tasa
    }
  };
};

const generarCarteraActiva = async ({ startTs, endTs, filtros }) => {
  const where = {
    fecha_inicio: { [Op.between]: [startTs, endTs] },
    status: { [Op.notIn]: ['PAGADO', 'CANCELADO'] }
  };
  if (filtros.modalidad) where.modalidad = String(filtros.modalidad).toUpperCase();
  if (filtros.estado) where.status = filtros.estado;

  const prestamos = await Prestamo.findAll({
    where,
    include: [
      {
        model: Solicitud,
        as: 'solicitud',
        attributes: ['cliente_id'],
        include: [{ model: Cliente, as: 'cliente', attributes: ['nombre', 'apellido'] }]
      }
    ],
    attributes: ['id', 'monto_solicitado', 'pendiente', 'num_semanas', 'status', 'modalidad']
  });

  const rows = prestamos.map((p) => ({
    prestamo_id: p.id,
    cliente: `${p?.solicitud?.cliente?.nombre || ''} ${p?.solicitud?.cliente?.apellido || ''}`.trim() || 'N/A',
    modalidad: p.modalidad || 'SEMANAL',
    estado: p.status || 'EN_PROCESO',
    monto_solicitado: round2(p.monto_solicitado),
    saldo_pendiente: round2(Math.max(toNumber(p.pendiente), 0)),
    plazo_semanas: toNumber(p.num_semanas)
  }));

  return {
    tipo: 'cartera-activa',
    columns: [
      { id: 'prestamo_id', label: 'Préstamo', type: 'string' },
      { id: 'cliente', label: 'Cliente', type: 'string' },
      { id: 'modalidad', label: 'Modalidad', type: 'string' },
      { id: 'estado', label: 'Estado', type: 'string' },
      { id: 'monto_solicitado', label: 'Monto solicitado', type: 'currency' },
      { id: 'saldo_pendiente', label: 'Saldo pendiente', type: 'currency' },
      { id: 'plazo_semanas', label: 'Plazo semanas', type: 'number' }
    ],
    rows,
    resumen: {
      prestamos_activos: rows.length,
      saldo_pendiente_total: round2(rows.reduce((acc, r) => acc + r.saldo_pendiente, 0)),
      ticket_promedio: rows.length ? round2(rows.reduce((acc, r) => acc + r.monto_solicitado, 0) / rows.length) : 0,
      plazo_promedio: rows.length ? round2(rows.reduce((acc, r) => acc + r.plazo_semanas, 0) / rows.length) : 0
    }
  };
};

const generarGananciasEsperadasCobradas = async ({ startTs, endTs, start, end }) => {
  const prestamos = await Prestamo.findAll({
    where: { fecha_inicio: { [Op.between]: [startTs, endTs] } },
    attributes: ['ganancias']
  });

  const cuotasPagadas = await Cuota.findAll({
    where: {
      fecha_pago: { [Op.between]: [startTs, endTs] },
      monto_pagado: { [Op.gt]: 0 }
    },
    attributes: ['monto_total', 'monto_interes', 'monto_pagado']
  });

  const gananciaEsperada = round2(prestamos.reduce((acc, item) => acc + toNumber(item.ganancias), 0));
  const gananciaCobrada = round2(cuotasPagadas.reduce((acc, cuota) => acc + cuotaInteresCobrado(cuota), 0));
  const gap = round2(gananciaEsperada - gananciaCobrada);
  const porcentaje = gananciaEsperada > 0 ? round2((gananciaCobrada / gananciaEsperada) * 100) : 0;

  return {
    tipo: 'ganancias-esperadas-cobradas',
    columns: [
      { id: 'periodo', label: 'Periodo', type: 'string' },
      { id: 'ganancia_esperada', label: 'Ganancia esperada', type: 'currency' },
      { id: 'ganancia_cobrada', label: 'Ganancia cobrada', type: 'currency' },
      { id: 'gap', label: 'Gap', type: 'currency' },
      { id: 'porcentaje_cobrado', label: '% cobrado', type: 'number' }
    ],
    rows: [
      {
        periodo: `${formatMMDDYYYY(start)} - ${formatMMDDYYYY(end)}`,
        ganancia_esperada: gananciaEsperada,
        ganancia_cobrada: gananciaCobrada,
        gap,
        porcentaje_cobrado: porcentaje
      }
    ],
    resumen: {
      ganancia_esperada_periodo: gananciaEsperada,
      ganancia_cobrada_periodo: gananciaCobrada,
      gap
    }
  };
};

const generarSaldoPendienteCliente = async ({ startYmd, endYmd, filtros }) => {
  const where = {
    fecha_vencimiento: { [Op.between]: [startYmd, endYmd] }
  };

  const cuotas = await Cuota.findAll({
    where,
    include: getBaseCuotaIncludes(),
    attributes: ['id', 'prestamo_id', 'monto_total', 'monto_pagado', 'estado']
  });

  const map = new Map();
  cuotas.forEach((cuota) => {
    const cliente = cuota?.prestamo?.solicitud?.cliente;
    if (!cliente) return;
    if (filtros.search) {
      const target = `${cliente.nombre || ''} ${cliente.apellido || ''}`.toLowerCase();
      if (!target.includes(String(filtros.search).toLowerCase())) return;
    }

    const saldo = round2(Math.max(toNumber(cuota.monto_total) - toNumber(cuota.monto_pagado), 0));
    if (saldo <= 0) return;

    const key = cliente.id;
    if (!map.has(key)) {
      map.set(key, {
        cliente_id: cliente.id,
        nombre_completo: `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim(),
        prestamos_set: new Set(),
        saldo_pendiente: 0
      });
    }
    const item = map.get(key);
    item.prestamos_set.add(cuota.prestamo_id);
    item.saldo_pendiente = round2(item.saldo_pendiente + saldo);
  });

  const rows = Array.from(map.values()).map((item) => ({
    cliente_id: item.cliente_id,
    nombre_completo: item.nombre_completo,
    prestamos_activos: item.prestamos_set.size,
    saldo_pendiente: item.saldo_pendiente
  })).sort((a, b) => b.saldo_pendiente - a.saldo_pendiente);

  return {
    tipo: 'saldo-pendiente-cliente',
    columns: [
      { id: 'cliente_id', label: 'Cliente ID', type: 'string' },
      { id: 'nombre_completo', label: 'Cliente', type: 'string' },
      { id: 'prestamos_activos', label: 'Préstamos activos', type: 'number' },
      { id: 'saldo_pendiente', label: 'Saldo pendiente', type: 'currency' }
    ],
    rows,
    resumen: {
      clientes_con_saldo: rows.length,
      saldo_pendiente_total: round2(rows.reduce((acc, item) => acc + item.saldo_pendiente, 0))
    }
  };
};

const generarMorasHistorialPagos = async ({ startYmd, endYmd }) => {
  const today = new Date();
  const cuotas = await Cuota.findAll({
    where: {
      fecha_vencimiento: { [Op.between]: [startYmd, endYmd] },
      estado: { [Op.in]: ['PENDIENTE', 'EN_MORA', 'PAGADO', 'PARCIAL'] }
    },
    include: getBaseCuotaIncludes(),
    attributes: ['id', 'prestamo_id', 'fecha_vencimiento', 'fecha_pago', 'monto_total', 'monto_pagado', 'observaciones']
  });

  const rows = cuotas.map((cuota) => {
    const mora = calculateMora(cuota, today);
    if (!mora) return null;
    const cliente = cuota?.prestamo?.solicitud?.cliente;
    return {
      cliente: cliente ? `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() : 'N/A',
      prestamo_id: cuota.prestamo_id,
      cuota_id: cuota.id,
      fecha_vencimiento: formatMMDDYYYY(cuota.fecha_vencimiento),
      fecha_pago: cuota.fecha_pago ? formatMMDDYYYY(cuota.fecha_pago) : null,
      dias_mora: mora.dias,
      monto_cuota: round2(cuota.monto_total),
      estado: mora.estado
    };
  }).filter(Boolean);

  return {
    tipo: 'moras-historial-pagos',
    columns: [
      { id: 'cliente', label: 'Cliente', type: 'string' },
      { id: 'prestamo_id', label: 'Préstamo', type: 'string' },
      { id: 'cuota_id', label: 'Cuota', type: 'string' },
      { id: 'fecha_vencimiento', label: 'Vence', type: 'date' },
      { id: 'fecha_pago', label: 'Pagada', type: 'date' },
      { id: 'dias_mora', label: 'Días mora', type: 'number' },
      { id: 'monto_cuota', label: 'Monto cuota', type: 'currency' },
      { id: 'estado', label: 'Estado', type: 'string' }
    ],
    rows,
    resumen: {
      total_registros_mora: rows.length,
      monto_total_mora: round2(rows.reduce((acc, item) => acc + toNumber(item.monto_cuota), 0))
    }
  };
};

const generarTopMorasDiarias = async ({ top }) => {
  const today = new Date();
  const todayYmd = toYmdString(today);
  const cuotas = await Cuota.findAll({
    where: {
      fecha_vencimiento: { [Op.lte]: todayYmd },
      estado: { [Op.in]: ['PENDIENTE', 'EN_MORA', 'PARCIAL'] }
    },
    include: getBaseCuotaIncludes(),
    attributes: ['id', 'prestamo_id', 'fecha_vencimiento', 'monto_total', 'monto_pagado']
  });

  const grouped = new Map();
  cuotas.forEach((cuota) => {
    const mora = calculateMora(cuota, today);
    if (!mora) return;
    const cliente = cuota?.prestamo?.solicitud?.cliente;
    const key = cliente?.id || 'N/A';

    if (!grouped.has(key)) {
      grouped.set(key, {
        fecha_reporte: formatMMDDYYYY(today),
        cliente_id: key,
        nombre_completo: cliente ? `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() : 'Cliente no identificado',
        cantidad_cuotas_en_mora: 0,
        monto_mora_hoy: 0,
        dias_mora_max: 0
      });
    }

    const item = grouped.get(key);
    item.cantidad_cuotas_en_mora += 1;
    item.monto_mora_hoy = round2(item.monto_mora_hoy + mora.saldo);
    item.dias_mora_max = Math.max(item.dias_mora_max, mora.dias);
  });

  const rows = Array.from(grouped.values())
    .sort((a, b) => b.monto_mora_hoy - a.monto_mora_hoy)
    .slice(0, top);

  return {
    tipo: 'top-moras-diarias',
    columns: [
      { id: 'fecha_reporte', label: 'Fecha reporte', type: 'date' },
      { id: 'cliente_id', label: 'Cliente ID', type: 'string' },
      { id: 'nombre_completo', label: 'Nombre completo', type: 'string' },
      { id: 'cantidad_cuotas_en_mora', label: 'Cuotas en mora', type: 'number' },
      { id: 'monto_mora_hoy', label: 'Monto mora hoy', type: 'currency' },
      { id: 'dias_mora_max', label: 'Días mora máx.', type: 'number' }
    ],
    rows,
    resumen: {
      fecha_reporte: formatMMDDYYYY(today),
      clientes_en_mora_hoy: rows.length,
      cuotas_en_mora_hoy: rows.reduce((acc, row) => acc + row.cantidad_cuotas_en_mora, 0),
      monto_total_en_mora_hoy: round2(rows.reduce((acc, row) => acc + row.monto_mora_hoy, 0))
    }
  };
};

const generarProductividadAnalistas = async ({ startTs, endTs, filtros }) => {
  const where = { creado_en: { [Op.between]: [startTs, endTs] } };
  if (filtros.analista_id) where.analista_id = filtros.analista_id;

  const solicitudes = await Solicitud.findAll({
    where,
    include: [{ model: Analista, as: 'analista', attributes: ['id', 'nombre', 'apellido', 'email'], required: false }],
    attributes: ['id', 'analista_id', 'estado']
  });

  const map = new Map();
  solicitudes.forEach((s) => {
    const key = s.analista_id || 'SIN_ANALISTA';
    if (!map.has(key)) {
      map.set(key, {
        analista_id: key === 'SIN_ANALISTA' ? null : key,
        analista: s?.analista ? `${s.analista.nombre || ''} ${s.analista.apellido || ''}`.trim() : 'Sin asignar',
        solicitudes_creadas: 0,
        aprobadas: 0,
        rechazadas: 0
      });
    }
    const item = map.get(key);
    item.solicitudes_creadas += 1;
    if (s.estado === 'APROBADO') item.aprobadas += 1;
    if (s.estado === 'RECHAZADO') item.rechazadas += 1;
  });

  const rows = Array.from(map.values()).map((item) => ({
    ...item,
    tasa_conversion: item.solicitudes_creadas > 0 ? round2((item.aprobadas / item.solicitudes_creadas) * 100) : 0
  })).sort((a, b) => b.aprobadas - a.aprobadas);

  return {
    tipo: 'productividad-analistas',
    columns: [
      { id: 'analista_id', label: 'Analista ID', type: 'string' },
      { id: 'analista', label: 'Analista', type: 'string' },
      { id: 'solicitudes_creadas', label: 'Solicitudes', type: 'number' },
      { id: 'aprobadas', label: 'Aprobadas', type: 'number' },
      { id: 'rechazadas', label: 'Rechazadas', type: 'number' },
      { id: 'tasa_conversion', label: 'Tasa conversión', type: 'number' }
    ],
    rows,
    resumen: {
      total_analistas: rows.length,
      total_solicitudes: rows.reduce((acc, item) => acc + item.solicitudes_creadas, 0),
      total_aprobadas: rows.reduce((acc, item) => acc + item.aprobadas, 0)
    }
  };
};

const generarNotificacionesEnvios = async ({ startTs, endTs, filtros }) => {
  await ensureReportTables();
  const rows = await sequelize.query(
    `SELECT id, canal, tipo, cliente_id, prestamo_id, cuota_id, destinatario, estado, provider_message_id, error, actor_analista_id, created_at
     FROM public.notificaciones_envios
     WHERE created_at BETWEEN :startTs AND :endTs
       AND (:estado IS NULL OR estado = :estado)
       AND (:search IS NULL OR destinatario ILIKE :searchLike)
     ORDER BY created_at DESC`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        startTs,
        endTs,
        estado: filtros.estado ? String(filtros.estado).toUpperCase() : null,
        search: filtros.search || null,
        searchLike: filtros.search ? `%${filtros.search}%` : null
      }
    }
  );

  const normalizedRows = rows.map((row) => ({
    ...row,
    created_at: row.created_at ? formatMMDDYYYY(row.created_at) : null
  }));

  return {
    tipo: 'notificaciones-envios',
    columns: [
      { id: 'created_at', label: 'Fecha', type: 'date' },
      { id: 'canal', label: 'Canal', type: 'string' },
      { id: 'tipo', label: 'Tipo', type: 'string' },
      { id: 'destinatario', label: 'Destinatario', type: 'string' },
      { id: 'estado', label: 'Estado', type: 'string' },
      { id: 'prestamo_id', label: 'Préstamo', type: 'string' }
    ],
    rows: normalizedRows,
    resumen: {
      total_envios: normalizedRows.length,
      enviados: normalizedRows.filter((r) => r.estado === 'ENVIADO').length,
      fallidos: normalizedRows.filter((r) => r.estado === 'FALLIDO').length,
      pendientes: normalizedRows.filter((r) => r.estado === 'PENDIENTE').length
    }
  };
};

const generarReferidosImpacto = async ({ startTs, endTs, filtros }) => {
  const clientesReferidos = await Cliente.findAll({
    where: {
      es_referido: true,
      fecha_registro: { [Op.between]: [startTs, endTs] }
    },
    attributes: ['id', 'nombre', 'apellido', 'referido_por', 'monto_referido']
  });

  const map = new Map();
  clientesReferidos.forEach((cliente) => {
    const key = String(cliente.referido_por || 'SIN_REFERIDOR').trim() || 'SIN_REFERIDOR';
    if (filtros.search && !key.toLowerCase().includes(String(filtros.search).toLowerCase())) return;

    if (!map.has(key)) {
      map.set(key, {
        referido_por: key,
        clientes_referidos: 0,
        monto_referido_total: 0
      });
    }
    const item = map.get(key);
    item.clientes_referidos += 1;
    item.monto_referido_total = round2(item.monto_referido_total + toNumber(cliente.monto_referido));
  });

  const rows = Array.from(map.values()).sort((a, b) => b.clientes_referidos - a.clientes_referidos);
  return {
    tipo: 'referidos-impacto',
    columns: [
      { id: 'referido_por', label: 'Referidor', type: 'string' },
      { id: 'clientes_referidos', label: 'Clientes referidos', type: 'number' },
      { id: 'monto_referido_total', label: 'Monto referido total', type: 'currency' }
    ],
    rows,
    resumen: {
      total_referidores: rows.length,
      total_clientes_referidos: rows.reduce((acc, item) => acc + item.clientes_referidos, 0),
      monto_referido_total: round2(rows.reduce((acc, item) => acc + item.monto_referido_total, 0))
    }
  };
};

const generarAnoContraAno = async ({ start, end }) => {
  const actualRange = buildDateRange({ fecha_inicio: formatMMDDYYYY(start), fecha_fin: formatMMDDYYYY(end) });
  const prevStart = new Date(start);
  const prevEnd = new Date(end);
  prevStart.setFullYear(prevStart.getFullYear() - 1);
  prevEnd.setFullYear(prevEnd.getFullYear() - 1);
  const prevRange = buildDateRange({ fecha_inicio: formatMMDDYYYY(prevStart), fecha_fin: formatMMDDYYYY(prevEnd) });

  const actualPipeline = await generarPipelineComercial({ ...actualRange, filtros: {} });
  const prevPipeline = await generarPipelineComercial({ ...prevRange, filtros: {} });
  const actualCartera = await generarCarteraActiva({ ...actualRange, filtros: {} });
  const prevCartera = await generarCarteraActiva({ ...prevRange, filtros: {} });

  const rows = [
    {
      kpi: 'solicitudes_aprobadas',
      actual: actualPipeline.resumen.solicitudes_aprobadas,
      anterior: prevPipeline.resumen.solicitudes_aprobadas
    },
    {
      kpi: 'saldo_pendiente_total',
      actual: actualCartera.resumen.saldo_pendiente_total,
      anterior: prevCartera.resumen.saldo_pendiente_total
    }
  ].map((item) => ({
    ...item,
    variacion_pct: item.anterior === 0 ? (item.actual > 0 ? 100 : 0) : round2(((item.actual - item.anterior) / item.anterior) * 100)
  }));

  return {
    tipo: 'ano-contra-ano',
    columns: [
      { id: 'kpi', label: 'KPI', type: 'string' },
      { id: 'actual', label: 'Actual', type: 'number' },
      { id: 'anterior', label: 'Año anterior', type: 'number' },
      { id: 'variacion_pct', label: 'Variación %', type: 'number' }
    ],
    rows,
    resumen: {
      periodo_actual: `${formatMMDDYYYY(start)} - ${formatMMDDYYYY(end)}`,
      periodo_anterior: `${formatMMDDYYYY(prevStart)} - ${formatMMDDYYYY(prevEnd)}`
    }
  };
};

const generarMetas = async ({ startTs, endTs, filtros }) => {
  const metaMonto = toNumber(filtros.meta_monto);
  const metaCantidad = toNumber(filtros.meta_cantidad);
  const prestamos = await Prestamo.findAll({
    where: { fecha_inicio: { [Op.between]: [startTs, endTs] } },
    attributes: ['id', 'monto_solicitado']
  });

  const montoActual = round2(prestamos.reduce((acc, p) => acc + toNumber(p.monto_solicitado), 0));
  const cantidadActual = prestamos.length;
  const cumplimientoMonto = metaMonto > 0 ? round2((montoActual / metaMonto) * 100) : 0;
  const cumplimientoCantidad = metaCantidad > 0 ? round2((cantidadActual / metaCantidad) * 100) : 0;

  return {
    tipo: 'metas',
    columns: [
      { id: 'indicador', label: 'Indicador', type: 'string' },
      { id: 'meta', label: 'Meta', type: 'number' },
      { id: 'actual', label: 'Actual', type: 'number' },
      { id: 'cumplimiento_pct', label: 'Cumplimiento %', type: 'number' },
      { id: 'brecha', label: 'Brecha', type: 'number' }
    ],
    rows: [
      {
        indicador: 'Monto colocado',
        meta: metaMonto,
        actual: montoActual,
        cumplimiento_pct: cumplimientoMonto,
        brecha: round2(metaMonto - montoActual)
      },
      {
        indicador: 'Cantidad de préstamos',
        meta: metaCantidad,
        actual: cantidadActual,
        cumplimiento_pct: cumplimientoCantidad,
        brecha: round2(metaCantidad - cantidadActual)
      }
    ],
    resumen: {
      meta_monto: metaMonto,
      meta_cantidad: metaCantidad,
      monto_actual: montoActual,
      cantidad_actual: cantidadActual,
      cumplimiento_monto_pct: cumplimientoMonto,
      cumplimiento_cantidad_pct: cumplimientoCantidad
    }
  };
};

const generarReporteData = async ({ tipo, filtros }) => {
  if (!TIPOS_REPORTE.has(tipo)) {
    const error = new Error('tipo no soportado');
    error.error_code = 'REPORT_TYPE_INVALID';
    throw error;
  }

  const range = buildDateRange(filtros);
  const top = Math.max(parseInt(filtros.top || '10', 10), 1);

  if (tipo === 'pipeline-comercial') return generarPipelineComercial({ ...range, filtros });
  if (tipo === 'cartera-activa') return generarCarteraActiva({ ...range, filtros });
  if (tipo === 'ganancias-esperadas-cobradas') return generarGananciasEsperadasCobradas({ ...range });
  if (tipo === 'saldo-pendiente-cliente') return generarSaldoPendienteCliente({ ...range, filtros });
  if (tipo === 'moras-historial-pagos') return generarMorasHistorialPagos({ ...range, filtros });
  if (tipo === 'top-moras-diarias') return generarTopMorasDiarias({ top });
  if (tipo === 'productividad-analistas') return generarProductividadAnalistas({ ...range, filtros });
  if (tipo === 'notificaciones-envios') return generarNotificacionesEnvios({ ...range, filtros });
  if (tipo === 'referidos-impacto') return generarReferidosImpacto({ ...range, filtros });
  if (tipo === 'ano-contra-ano') return generarAnoContraAno({ start: range.start, end: range.end });
  if (tipo === 'metas') return generarMetas({ ...range, filtros });

  const error = new Error('tipo no soportado');
  error.error_code = 'REPORT_TYPE_INVALID';
  throw error;
};

const generarReporte = async ({ tipo, filtros, user }) => {
  const reporte = await generarReporteData({ tipo, filtros });
  const paged = withPagination(reporte.rows, filtros.page, filtros.limit);

  const response = {
    tipo: reporte.tipo,
    columns: reporte.columns,
    rows: paged.rows,
    resumen: reporte.resumen,
    pagination: paged.pagination,
    meta: {
      fecha_inicio: filtros.fecha_inicio,
      fecha_fin: filtros.fecha_fin,
      timezone: TIMEZONE,
      generated_at: new Date().toISOString(),
      version: VERSION
    }
  };

  await registrarAuditoriaEvento({
    user,
    accion: 'GENERACION_REPORTE',
    modulo: 'Reportes',
    entidad: 'reporte',
    entidad_id: tipo,
    payload: {
      tipo,
      fecha_inicio: filtros.fecha_inicio,
      fecha_fin: filtros.fecha_fin,
      page: filtros.page,
      limit: filtros.limit
    },
    resultado: 'OK'
  });

  return response;
};

const generarKpisResumen = async ({ filtros, user }) => {
  const range = buildDateRange(filtros);
  const pipeline = await generarPipelineComercial({ ...range, filtros });
  const cartera = await generarCarteraActiva({ ...range, filtros });
  const moras = await generarTopMorasDiarias({ top: 10000 });
  const ganancias = await generarGananciasEsperadasCobradas({ ...range });

  const data = {
    solicitudes_creadas: pipeline.resumen.solicitudes_creadas,
    solicitudes_aprobadas: pipeline.resumen.solicitudes_aprobadas,
    solicitudes_rechazadas: pipeline.resumen.solicitudes_rechazadas,
    tasa_conversion: pipeline.resumen.tasa_conversion,
    prestamos_activos: cartera.resumen.prestamos_activos,
    saldo_pendiente_total: cartera.resumen.saldo_pendiente_total,
    ticket_promedio: cartera.resumen.ticket_promedio,
    plazo_promedio: cartera.resumen.plazo_promedio,
    clientes_en_mora_hoy: moras.resumen.clientes_en_mora_hoy,
    cuotas_en_mora_hoy: moras.resumen.cuotas_en_mora_hoy,
    monto_total_en_mora_hoy: moras.resumen.monto_total_en_mora_hoy,
    ganancia_esperada_periodo: ganancias.resumen.ganancia_esperada_periodo,
    ganancia_cobrada_periodo: ganancias.resumen.ganancia_cobrada_periodo
  };

  await registrarAuditoriaEvento({
    user,
    accion: 'KPIS_REPORTE',
    modulo: 'Reportes',
    entidad: 'kpis',
    payload: { fecha_inicio: filtros.fecha_inicio, fecha_fin: filtros.fecha_fin },
    resultado: 'OK'
  });

  return data;
};

const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const exportReport = async ({ tipo, filtros, formato = 'csv', user }) => {
  const reporte = await generarReporteData({ tipo, filtros });
  const columns = reporte.columns || [];
  const rows = reporte.rows || [];
  const timestamp = new Date();
  const yyyy = timestamp.getFullYear();
  const mm = String(timestamp.getMonth() + 1).padStart(2, '0');
  const dd = String(timestamp.getDate()).padStart(2, '0');
  const hh = String(timestamp.getHours()).padStart(2, '0');
  const mi = String(timestamp.getMinutes()).padStart(2, '0');
  const fileStamp = `${yyyy}${mm}${dd}_${hh}${mi}`;
  const filename = `reporte_${tipo}_${fileStamp}.${formato === 'xlsx' ? 'xlsx' : 'csv'}`;

  let buffer;
  let contentType;
  if (formato === 'xlsx') {
    const sheetRows = rows.map((row) => {
      const obj = {};
      columns.forEach((col) => {
        obj[col.label || col.id] = row[col.id];
      });
      return obj;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
    buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    const header = columns.map((c) => escapeCsv(c.label || c.id)).join(',');
    const lines = [header];
    rows.forEach((row) => {
      lines.push(columns.map((c) => escapeCsv(row[c.id])).join(','));
    });
    buffer = Buffer.from(lines.join('\n'), 'utf-8');
    contentType = 'text/csv; charset=utf-8';
  }

  await registrarAuditoriaEvento({
    user,
    accion: 'EXPORT_REPORTE',
    modulo: 'Reportes',
    entidad: 'reporte',
    entidad_id: tipo,
    payload: { tipo, fecha_inicio: filtros.fecha_inicio, fecha_fin: filtros.fecha_fin, formato },
    resultado: 'OK'
  });

  return { filename, buffer, contentType };
};

const enviarCuotasPendientesAdmin = async ({ filtros, adminEmail, user }) => {
  const range = buildDateRange(filtros);
  const reporte = await generarMorasHistorialPagos({ ...range });
  const rows = reporte.rows || [];

  const csvHeader = ['cliente', 'prestamo_id', 'cuota_id', 'fecha_vencimiento', 'fecha_pago', 'dias_mora', 'monto_cuota', 'estado'];
  const lines = [csvHeader.join(',')];
  rows.forEach((row) => {
    lines.push(csvHeader.map((key) => escapeCsv(row[key])).join(','));
  });
  const csvAttachment = Buffer.from(lines.join('\n'), 'utf-8');

  const mailResult = await sendMailWithReportCsv({
    to: adminEmail,
    subject: 'CrediFlash - Cuotas pendientes y en mora',
    text: `Reporte generado del ${filtros.fecha_inicio} al ${filtros.fecha_fin}. Total registros: ${rows.length}`,
    filename: `cuotas_pendientes_${Date.now()}.csv`,
    fileBuffer: csvAttachment
  });

  await registrarAuditoriaEvento({
    user,
    accion: 'REPORTE_CUOTAS_PENDIENTES_EMAIL',
    modulo: 'Reportes',
    entidad: 'notificacion',
    payload: { adminEmail, registros: rows.length },
    resultado: 'OK'
  });

  return {
    admin_email_destino: adminEmail,
    total_cuotas_pendientes: rows.filter((r) => r.estado === 'EN_MORA').length,
    total_en_mora: rows.length,
    enviado: true,
    enviado_en: new Date().toISOString(),
    message_id: mailResult?.messageId || null
  };
};

module.exports = {
  TIPOS_REPORTE,
  generarReporte,
  generarKpisResumen,
  exportReport,
  enviarCuotasPendientesAdmin,
  ensureReportTables
};
