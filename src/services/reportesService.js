const { Op } = require('sequelize');
const { Cuota, Prestamo, Solicitud, Cliente } = require('../models');
const { sendMailWithReportCsv } = require('../utils/emailNotificationService');

const TIPOS_REPORTE = new Set([
  'ganancias-esperadas-cobradas',
  'saldo-pendiente-cliente',
  'moras-historial-pagos',
  'ano-contra-ano',
  'metas',
  'top-moras-diarias',
  'cuotas-pendientes-correo-admin'
]);

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const round2 = (value) => Number(toNumber(value).toFixed(2));

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildDateRange = ({ fecha_inicio, fecha_fin }) => {
  const start = toDate(fecha_inicio);
  const end = toDate(fecha_fin);

  if (!start || !end) {
    throw new Error('fecha_inicio y fecha_fin deben tener formato YYYY-MM-DD');
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (start > end) {
    throw new Error('fecha_inicio no puede ser mayor que fecha_fin');
  }

  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 731) {
    throw new Error('El rango máximo permitido es de 24 meses');
  }

  return { start, end };
};

const cuotaInteresCobrado = (cuota) => {
  const montoTotal = toNumber(cuota.monto_total);
  const montoInteres = toNumber(cuota.monto_interes);
  const montoPagado = toNumber(cuota.monto_pagado);
  if (montoTotal <= 0 || montoInteres <= 0 || montoPagado <= 0) return 0;
  const proporcionInteres = montoInteres / montoTotal;
  return round2(montoPagado * proporcionInteres);
};

const extractCuotaNumero = (observaciones) => {
  const text = String(observaciones || '');
  const match = text.match(/Cuota\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
};

const calculateMora = (cuota, today) => {
  const fechaVencimiento = toDate(cuota.fecha_vencimiento);
  if (!fechaVencimiento) return null;

  const montoTotal = toNumber(cuota.monto_total);
  const montoPagado = toNumber(cuota.monto_pagado);
  const saldo = round2(Math.max(montoTotal - montoPagado, 0));
  if (saldo <= 0) return null;

  const fechaPago = cuota.fecha_pago ? toDate(cuota.fecha_pago) : null;
  if (fechaPago && fechaPago > fechaVencimiento) {
    const dias = Math.ceil((fechaPago.getTime() - fechaVencimiento.getTime()) / (1000 * 60 * 60 * 24));
    return { dias, estado: 'MORA_PAGADA', saldo, fechaPago };
  }

  if (!fechaPago && today > fechaVencimiento) {
    const dias = Math.ceil((today.getTime() - fechaVencimiento.getTime()) / (1000 * 60 * 60 * 24));
    return { dias, estado: 'EN_MORA', saldo, fechaPago: null };
  }

  return null;
};

const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
};

const getBaseIncludes = () => ([
  {
    model: Prestamo,
    as: 'prestamo',
    include: [
      {
        model: Solicitud,
        as: 'solicitud',
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

const generarGananciasEsperadasCobradas = async ({ start, end }) => {
  const prestamos = await Prestamo.findAll({
    where: { fecha_inicio: { [Op.between]: [start, end] } },
    attributes: ['id', 'fecha_inicio', 'ganancias']
  });

  const cuotasPagadas = await Cuota.findAll({
    where: {
      fecha_pago: { [Op.between]: [start, end] },
      monto_pagado: { [Op.gt]: 0 }
    },
    attributes: ['id', 'monto_total', 'monto_interes', 'monto_pagado', 'fecha_pago']
  });

  const gananciaEsperada = round2(prestamos.reduce((acc, item) => acc + toNumber(item.ganancias), 0));
  const gananciaCobrada = round2(cuotasPagadas.reduce((acc, cuota) => acc + cuotaInteresCobrado(cuota), 0));
  const diferencia = round2(gananciaEsperada - gananciaCobrada);
  const porcentaje = gananciaEsperada > 0 ? round2((gananciaCobrada / gananciaEsperada) * 100) : 0;

  return {
    tipo: 'ganancias-esperadas-cobradas',
    resumen: {
      ganancia_esperada: gananciaEsperada,
      ganancia_cobrada: gananciaCobrada,
      diferencia,
      porcentaje_cobrado: porcentaje
    },
    columns: [
      { id: 'periodo', label: 'Periodo' },
      { id: 'ganancia_esperada', label: 'Ganancia esperada' },
      { id: 'ganancia_cobrada', label: 'Ganancia cobrada' },
      { id: 'diferencia', label: 'Diferencia' },
      { id: 'porcentaje_cobrado', label: '% cobrado' }
    ],
    rows: [
      {
        periodo: `${formatDate(start)} - ${formatDate(end)}`,
        ganancia_esperada: gananciaEsperada,
        ganancia_cobrada: gananciaCobrada,
        diferencia,
        porcentaje_cobrado: porcentaje
      }
    ]
  };
};

const generarSaldoPendienteCliente = async ({ start, end }) => {
  const cuotas = await Cuota.findAll({
    where: {
      fecha_vencimiento: { [Op.between]: [formatDate(start), formatDate(end)] }
    },
    include: getBaseIncludes(),
    attributes: ['id', 'prestamo_id', 'monto_total', 'monto_pagado', 'estado']
  });

  const map = new Map();
  cuotas.forEach((cuota) => {
    const cliente = cuota?.prestamo?.solicitud?.cliente;
    if (!cliente) return;

    const saldo = round2(Math.max(toNumber(cuota.monto_total) - toNumber(cuota.monto_pagado), 0));
    if (saldo <= 0) return;

    const key = cliente.id;
    if (!map.has(key)) {
      map.set(key, {
        cliente_id: cliente.id,
        nombre_completo: `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim(),
        prestamos_activos_set: new Set(),
        saldo_pendiente: 0
      });
    }

    const item = map.get(key);
    item.prestamos_activos_set.add(cuota.prestamo_id);
    item.saldo_pendiente = round2(item.saldo_pendiente + saldo);
  });

  const rows = Array.from(map.values()).map((item) => ({
    cliente_id: item.cliente_id,
    nombre_completo: item.nombre_completo,
    prestamos_activos: item.prestamos_activos_set.size,
    saldo_pendiente: item.saldo_pendiente
  }));

  rows.sort((a, b) => b.saldo_pendiente - a.saldo_pendiente);

  return {
    tipo: 'saldo-pendiente-cliente',
    resumen: {
      clientes_con_saldo: rows.length,
      saldo_pendiente_total: round2(rows.reduce((acc, item) => acc + item.saldo_pendiente, 0))
    },
    columns: [
      { id: 'cliente_id', label: 'Cliente ID' },
      { id: 'nombre_completo', label: 'Cliente' },
      { id: 'prestamos_activos', label: 'Préstamos activos' },
      { id: 'saldo_pendiente', label: 'Saldo pendiente' }
    ],
    rows
  };
};

const generarMorasHistorialPagos = async ({ start, end }) => {
  const today = new Date();
  const cuotas = await Cuota.findAll({
    where: {
      fecha_vencimiento: { [Op.between]: [formatDate(start), formatDate(end)] }
    },
    include: getBaseIncludes(),
    attributes: ['id', 'prestamo_id', 'fecha_vencimiento', 'fecha_pago', 'monto_total', 'monto_pagado', 'estado', 'observaciones']
  });

  const rows = [];
  cuotas.forEach((cuota) => {
    const mora = calculateMora(cuota, today);
    if (!mora) return;
    const cliente = cuota?.prestamo?.solicitud?.cliente;
    rows.push({
      cliente: cliente ? `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() : 'N/A',
      prestamo_id: cuota.prestamo_id,
      cuota_numero: extractCuotaNumero(cuota.observaciones),
      fecha_vencimiento: formatDate(cuota.fecha_vencimiento),
      fecha_pago: formatDate(cuota.fecha_pago),
      dias_mora: mora.dias,
      monto_cuota: toNumber(cuota.monto_total),
      estado: mora.estado
    });
  });

  rows.sort((a, b) => b.dias_mora - a.dias_mora);

  return {
    tipo: 'moras-historial-pagos',
    resumen: {
      total_moras: rows.length,
      dias_mora_promedio: rows.length ? round2(rows.reduce((acc, r) => acc + r.dias_mora, 0) / rows.length) : 0,
      monto_en_mora: round2(rows.reduce((acc, r) => acc + toNumber(r.monto_cuota), 0))
    },
    columns: [
      { id: 'cliente', label: 'Cliente' },
      { id: 'prestamo_id', label: 'Préstamo' },
      { id: 'cuota_numero', label: 'Cuota #' },
      { id: 'fecha_vencimiento', label: 'Vence' },
      { id: 'fecha_pago', label: 'Pagada' },
      { id: 'dias_mora', label: 'Días mora' },
      { id: 'monto_cuota', label: 'Monto cuota' },
      { id: 'estado', label: 'Estado' }
    ],
    rows
  };
};

const calcularKpisPeriodo = async ({ start, end }) => {
  const prestamos = await Prestamo.findAll({
    where: { fecha_inicio: { [Op.between]: [start, end] } },
    attributes: ['id', 'monto_solicitado']
  });

  const cuotasPagadas = await Cuota.findAll({
    where: {
      fecha_pago: { [Op.between]: [start, end] },
      monto_pagado: { [Op.gt]: 0 }
    },
    attributes: ['id', 'monto_pagado']
  });

  const cuotasMora = await Cuota.findAll({
    where: {
      fecha_vencimiento: { [Op.between]: [formatDate(start), formatDate(end)] },
      estado: { [Op.in]: ['PENDIENTE', 'EN_MORA', 'PARCIAL'] }
    },
    attributes: ['id', 'monto_total', 'monto_pagado', 'fecha_vencimiento', 'fecha_pago']
  });

  const solicitudes = await Solicitud.findAll({
    where: { creado_en: { [Op.between]: [start, end] } },
    attributes: ['id', 'estado']
  });

  const moraTotal = cuotasMora.reduce((acc, cuota) => {
    const mora = calculateMora(cuota, new Date());
    return acc + (mora ? mora.saldo : 0);
  }, 0);

  const solicitudesTotal = solicitudes.length;
  const solicitudesAprobadas = solicitudes.filter((item) => item.estado === 'APROBADO').length;

  return {
    monto_colocado: round2(prestamos.reduce((acc, item) => acc + toNumber(item.monto_solicitado), 0)),
    monto_cobrado: round2(cuotasPagadas.reduce((acc, item) => acc + toNumber(item.monto_pagado), 0)),
    mora_total: round2(moraTotal),
    tasa_aprobacion: solicitudesTotal > 0
      ? round2((solicitudesAprobadas / solicitudesTotal) * 100)
      : 0
  };
};

const variacion = (actual, anterior) => {
  if (toNumber(anterior) === 0) return actual > 0 ? 100 : 0;
  return round2(((toNumber(actual) - toNumber(anterior)) / toNumber(anterior)) * 100);
};

const generarAnoContraAno = async ({ start, end }) => {
  const prevStart = new Date(start);
  prevStart.setFullYear(prevStart.getFullYear() - 1);
  const prevEnd = new Date(end);
  prevEnd.setFullYear(prevEnd.getFullYear() - 1);

  const actual = await calcularKpisPeriodo({ start, end });
  const anterior = await calcularKpisPeriodo({ start: prevStart, end: prevEnd });

  const rows = [
    {
      kpi: 'monto_colocado',
      actual: actual.monto_colocado,
      anterior: anterior.monto_colocado,
      variacion_pct: variacion(actual.monto_colocado, anterior.monto_colocado)
    },
    {
      kpi: 'monto_cobrado',
      actual: actual.monto_cobrado,
      anterior: anterior.monto_cobrado,
      variacion_pct: variacion(actual.monto_cobrado, anterior.monto_cobrado)
    },
    {
      kpi: 'mora_total',
      actual: actual.mora_total,
      anterior: anterior.mora_total,
      variacion_pct: variacion(actual.mora_total, anterior.mora_total)
    },
    {
      kpi: 'tasa_aprobacion',
      actual: actual.tasa_aprobacion,
      anterior: anterior.tasa_aprobacion,
      variacion_pct: variacion(actual.tasa_aprobacion, anterior.tasa_aprobacion)
    }
  ];

  return {
    tipo: 'ano-contra-ano',
    resumen: {
      periodo_actual: `${formatDate(start)} - ${formatDate(end)}`,
      periodo_anterior: `${formatDate(prevStart)} - ${formatDate(prevEnd)}`
    },
    columns: [
      { id: 'kpi', label: 'KPI' },
      { id: 'actual', label: 'Actual' },
      { id: 'anterior', label: 'Año anterior' },
      { id: 'variacion_pct', label: 'Variación %' }
    ],
    rows
  };
};

const generarMetas = async ({ start, end, meta_monto, meta_cantidad }) => {
  const metaMonto = toNumber(meta_monto);
  const metaCantidad = toNumber(meta_cantidad);

  const prestamos = await Prestamo.findAll({
    where: { fecha_inicio: { [Op.between]: [start, end] } },
    attributes: ['id', 'monto_solicitado']
  });

  const montoActual = round2(prestamos.reduce((acc, item) => acc + toNumber(item.monto_solicitado), 0));
  const cantidadActual = prestamos.length;

  const cumplimientoMontoPct = metaMonto > 0 ? round2((montoActual / metaMonto) * 100) : 0;
  const cumplimientoCantidadPct = metaCantidad > 0 ? round2((cantidadActual / metaCantidad) * 100) : 0;

  return {
    tipo: 'metas',
    resumen: {
      meta_monto: metaMonto,
      meta_cantidad: metaCantidad,
      monto_actual: montoActual,
      cantidad_actual: cantidadActual,
      cumplimiento_monto_pct: cumplimientoMontoPct,
      cumplimiento_cantidad_pct: cumplimientoCantidadPct,
      brecha_monto: round2(metaMonto - montoActual),
      brecha_cantidad: round2(metaCantidad - cantidadActual)
    },
    columns: [
      { id: 'indicador', label: 'Indicador' },
      { id: 'meta', label: 'Meta' },
      { id: 'actual', label: 'Actual' },
      { id: 'cumplimiento_pct', label: 'Cumplimiento %' },
      { id: 'brecha', label: 'Brecha' }
    ],
    rows: [
      {
        indicador: 'Monto colocado',
        meta: metaMonto,
        actual: montoActual,
        cumplimiento_pct: cumplimientoMontoPct,
        brecha: round2(metaMonto - montoActual)
      },
      {
        indicador: 'Cantidad de préstamos',
        meta: metaCantidad,
        actual: cantidadActual,
        cumplimiento_pct: cumplimientoCantidadPct,
        brecha: round2(metaCantidad - cantidadActual)
      }
    ]
  };
};

const generarTopMorasDiarias = async ({ start, end, top }) => {
  const today = new Date();
  const cuotas = await Cuota.findAll({
    where: {
      fecha_vencimiento: { [Op.between]: [formatDate(start), formatDate(end)] },
      estado: { [Op.in]: ['PENDIENTE', 'EN_MORA', 'PARCIAL'] }
    },
    attributes: ['id', 'fecha_vencimiento', 'monto_total', 'monto_pagado', 'fecha_pago']
  });

  const grouped = new Map();
  cuotas.forEach((cuota) => {
    const mora = calculateMora(cuota, today);
    if (!mora) return;

    const key = formatDate(cuota.fecha_vencimiento);
    if (!grouped.has(key)) {
      grouped.set(key, { fecha: key, cantidad_moras: 0, monto_mora: 0 });
    }
    const item = grouped.get(key);
    item.cantidad_moras += 1;
    item.monto_mora = round2(item.monto_mora + mora.saldo);
  });

  const rows = Array.from(grouped.values())
    .sort((a, b) => b.monto_mora - a.monto_mora)
    .slice(0, top);

  return {
    tipo: 'top-moras-diarias',
    resumen: {
      total_dias_con_mora: rows.length,
      top
    },
    columns: [
      { id: 'fecha', label: 'Fecha' },
      { id: 'cantidad_moras', label: 'Cantidad moras' },
      { id: 'monto_mora', label: 'Monto mora' }
    ],
    rows
  };
};

const convertirFilasCsv = (rows) => {
  const headers = [
    'cliente',
    'cliente_email',
    'prestamo_id',
    'cuota_id',
    'fecha_vencimiento',
    'estado',
    'monto_total',
    'monto_pagado',
    'saldo_pendiente',
    'dias_mora'
  ];
  const lines = [headers.join(',')];

  rows.forEach((row) => {
    const line = [
      row.cliente,
      row.cliente_email,
      row.prestamo_id,
      row.cuota_id,
      row.fecha_vencimiento,
      row.estado,
      row.monto_total,
      row.monto_pagado,
      row.saldo_pendiente,
      row.dias_mora
    ].map((item) => `"${String(item ?? '').replace(/"/g, '""')}"`);
    lines.push(line.join(','));
  });

  return Buffer.from(lines.join('\n'), 'utf-8');
};

const generarCuotasPendientesCorreoAdmin = async ({ start, end, adminEmail }) => {
  const today = new Date();
  const cuotas = await Cuota.findAll({
    where: {
      fecha_vencimiento: { [Op.between]: [formatDate(start), formatDate(end)] },
      estado: { [Op.in]: ['PENDIENTE', 'EN_MORA', 'PARCIAL'] }
    },
    include: getBaseIncludes(),
    attributes: ['id', 'prestamo_id', 'fecha_vencimiento', 'fecha_pago', 'monto_total', 'monto_pagado', 'estado']
  });

  const rows = cuotas.map((cuota) => {
    const cliente = cuota?.prestamo?.solicitud?.cliente;
    const mora = calculateMora(cuota, today);
    const saldoPendiente = round2(Math.max(toNumber(cuota.monto_total) - toNumber(cuota.monto_pagado), 0));
    return {
      cuota_id: cuota.id,
      prestamo_id: cuota.prestamo_id,
      cliente: cliente ? `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() : 'N/A',
      cliente_email: cliente?.email || '',
      fecha_vencimiento: formatDate(cuota.fecha_vencimiento),
      estado: mora ? mora.estado : 'PENDIENTE',
      monto_total: toNumber(cuota.monto_total),
      monto_pagado: toNumber(cuota.monto_pagado),
      saldo_pendiente: saldoPendiente,
      dias_mora: mora ? mora.dias : 0
    };
  });

  const totalPendientes = rows.filter((item) => item.estado === 'PENDIENTE').length;
  const totalMora = rows.filter((item) => item.estado === 'EN_MORA' || item.estado === 'MORA_PAGADA').length;
  const csvAttachment = convertirFilasCsv(rows);

  const mailResult = await sendMailWithReportCsv({
    to: adminEmail,
    subject: 'CrediFlash - Reporte de cuotas pendientes y mora',
    text: `Reporte generado del ${formatDate(start)} al ${formatDate(end)}. Pendientes: ${totalPendientes}. En mora: ${totalMora}.`,
    filename: `cuotas_pendientes_${Date.now()}.csv`,
    fileBuffer: csvAttachment
  });

  return {
    tipo: 'cuotas-pendientes-correo-admin',
    resumen: {
      admin_email_destino: adminEmail,
      total_cuotas_pendientes: totalPendientes,
      total_en_mora: totalMora,
      enviado: true,
      enviado_en: new Date().toISOString(),
      message_id: mailResult?.messageId || null
    },
    columns: [
      { id: 'cliente', label: 'Cliente' },
      { id: 'cliente_email', label: 'Correo' },
      { id: 'prestamo_id', label: 'Préstamo' },
      { id: 'cuota_id', label: 'Cuota' },
      { id: 'fecha_vencimiento', label: 'Vence' },
      { id: 'estado', label: 'Estado' },
      { id: 'saldo_pendiente', label: 'Saldo pendiente' },
      { id: 'dias_mora', label: 'Días mora' }
    ],
    rows
  };
};

const withPagination = (rows = [], page = 1, limit = 1000) => {
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const currentLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 5000);
  const offset = (currentPage - 1) * currentLimit;
  const paginatedRows = rows.slice(offset, offset + currentLimit);
  return {
    rows: paginatedRows,
    pagination: {
      page: currentPage,
      limit: currentLimit,
      total: rows.length,
      pages: Math.ceil(rows.length / currentLimit)
    }
  };
};

const generarReporte = async ({ tipo, filtros, user }) => {
  if (!TIPOS_REPORTE.has(tipo)) {
    throw new Error('tipo inválido. Valores permitidos: ganancias-esperadas-cobradas, saldo-pendiente-cliente, moras-historial-pagos, ano-contra-ano, metas, top-moras-diarias, cuotas-pendientes-correo-admin');
  }

  const { start, end } = buildDateRange(filtros);
  const top = Math.max(parseInt(filtros.top || '10', 10), 1);
  const adminEmail = process.env.REPORTES_ADMIN_EMAIL || process.env.SMTP_BCC || process.env.SMTP_USER || 'creditflashadmin@gmail.com';

  let response;
  if (tipo === 'ganancias-esperadas-cobradas') {
    response = await generarGananciasEsperadasCobradas({ start, end });
  } else if (tipo === 'saldo-pendiente-cliente') {
    response = await generarSaldoPendienteCliente({ start, end });
  } else if (tipo === 'moras-historial-pagos') {
    response = await generarMorasHistorialPagos({ start, end });
  } else if (tipo === 'ano-contra-ano') {
    response = await generarAnoContraAno({ start, end });
  } else if (tipo === 'metas') {
    response = await generarMetas({
      start,
      end,
      meta_monto: filtros.meta_monto,
      meta_cantidad: filtros.meta_cantidad
    });
  } else if (tipo === 'top-moras-diarias') {
    response = await generarTopMorasDiarias({ start, end, top });
  } else if (tipo === 'cuotas-pendientes-correo-admin') {
    response = await generarCuotasPendientesCorreoAdmin({ start, end, adminEmail, user });
  } else {
    throw new Error('tipo de reporte no soportado');
  }

  const paged = withPagination(response.rows, filtros.page, filtros.limit);

  return {
    tipo: response.tipo,
    rango: {
      fecha_inicio: formatDate(start),
      fecha_fin: formatDate(end)
    },
    resumen: response.resumen,
    columns: response.columns,
    rows: paged.rows,
    pagination: paged.pagination
  };
};

module.exports = {
  generarReporte,
  TIPOS_REPORTE
};
