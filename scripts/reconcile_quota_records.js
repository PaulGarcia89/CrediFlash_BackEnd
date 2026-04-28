require('dotenv').config();

const { sequelize, Prestamo, Cuota } = require('../src/models');
const { ensurePrestamoAbonoParcialColumns } = require('../src/utils/prestamoAbonos');

const round2 = (value) => Number((Number(value) || 0).toFixed(2));
const parseArgs = () => {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith('--')).map((arg) => arg.replace(/^--/, '')));
  const loanIdIndex = args.indexOf('--prestamo-id');

  return {
    apply: flags.has('apply'),
    verbose: flags.has('verbose'),
    prestamoId: loanIdIndex >= 0 ? args[loanIdIndex + 1] || null : null
  };
};

const resolveLoanStatus = ({ pagadoTotal, pendienteTotal, cuotasConSaldo, hayMora }) => {
  if (pendienteTotal <= 0 && pagadoTotal > 0) return 'PAGADO';
  if (hayMora) return 'MOROSO';
  if (pagadoTotal > 0 && cuotasConSaldo > 0) return 'EN_MARCHA';
  if (cuotasConSaldo > 0) return 'ACTIVO';
  return 'PAGADO';
};

const summarizeQuotas = (cuotas = []) => {
  return cuotas.reduce((acc, cuota) => {
    const capital = round2(cuota.monto_capital);
    const interes = round2(cuota.monto_interes);
    const existingTotal = round2(cuota.monto_total);
    const normalizedTotal = existingTotal > 0 ? existingTotal : round2(capital + interes);
    const pagado = Math.max(round2(cuota.monto_pagado), 0);
    const saldo = round2(Math.max(normalizedTotal - pagado, 0));
    const estado = pagado >= normalizedTotal ? 'PAGADO' : 'PENDIENTE';
    const fechaPago = estado === 'PAGADO'
      ? (cuota.fecha_pago || cuota.created_at || null)
      : cuota.fecha_pago || null;

    acc.quotaUpdates.push({
      cuota,
      updates: {
        monto_total: normalizedTotal,
        monto_pagado: pagado,
        estado,
        saldo_pendiente: saldo,
        fecha_pago: fechaPago
      }
    });

    acc.pagadoTotal += Math.min(pagado, normalizedTotal);
    acc.pendienteTotal += saldo;
    if (saldo > 0) {
      acc.cuotasConSaldo += 1;
      const fechaVto = new Date(cuota.fecha_vencimiento);
      if (!Number.isNaN(fechaVto.getTime())) {
        fechaVto.setHours(0, 0, 0, 0);
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        if (fechaVto < hoy) acc.hayMora = true;
      }
    }

    return acc;
  }, {
    quotaUpdates: [],
    pagadoTotal: 0,
    pendienteTotal: 0,
    cuotasConSaldo: 0,
    hayMora: false
  });
};

const run = async () => {
  const { apply, verbose, prestamoId } = parseArgs();

  await sequelize.authenticate();
  await ensurePrestamoAbonoParcialColumns(sequelize);

  const where = {};
  if (prestamoId) {
    where.id = prestamoId;
  }

  const prestamos = await Prestamo.findAll({
    where,
    include: [{
      model: Cuota,
      as: 'cuotas'
    }],
    order: [['fecha_inicio', 'ASC']]
  });

  console.log(`Encontrados ${prestamos.length} préstamos para revisar.`);

  let prestamosActualizados = 0;
  let cuotasActualizadas = 0;
  let incidencias = 0;

  for (const prestamo of prestamos) {
    const cuotas = Array.isArray(prestamo.cuotas) ? prestamo.cuotas : [];
    if (cuotas.length === 0) continue;

    const resumen = summarizeQuotas(cuotas);
    const pagosHechos = cuotas.length - resumen.cuotasConSaldo;
    const pagosPendientes = resumen.cuotasConSaldo;
    const abonoParcialAcumulado = (() => {
      const primeraCuotaPendiente = cuotas
        .slice()
        .sort((a, b) => {
          const fechaA = new Date(a.fecha_vencimiento || 0).getTime();
          const fechaB = new Date(b.fecha_vencimiento || 0).getTime();
          if (fechaA !== fechaB) return fechaA - fechaB;
          return String(a.id || '').localeCompare(String(b.id || ''));
        })
        .find((cuota) => round2(cuota.monto_total) > round2(cuota.monto_pagado));

      return primeraCuotaPendiente ? round2(primeraCuotaPendiente.monto_pagado) : 0;
    })();
    const estado = resolveLoanStatus({
      pagadoTotal: round2(resumen.pagadoTotal),
      pendienteTotal: round2(resumen.pendienteTotal),
      cuotasConSaldo: resumen.cuotasConSaldo,
      hayMora: resumen.hayMora
    });

    const cambiosPrestamo = {
      pagado: round2(resumen.pagadoTotal),
      pendiente: round2(resumen.pendienteTotal),
      pagos_hechos: pagosHechos,
      pagos_pendientes: pagosPendientes,
      abono_parcial_acumulado: abonoParcialAcumulado,
      status: estado
    };

    const prestamoNecesitaCambio = Object.entries(cambiosPrestamo).some(([key, value]) => {
      const current = key === 'status' ? prestamo[key] : round2(prestamo[key]);
      return String(current) !== String(value);
    });

    const cuotasNecesitanCambio = resumen.quotaUpdates.filter(({ cuota, updates }) => {
      const estadoActual = String(cuota.estado || '').toUpperCase();
      const estadoNuevo = String(updates.estado || '').toUpperCase();
      const totalActual = round2(cuota.monto_total);
      const totalNuevo = round2(updates.monto_total);
      const pagadoActual = round2(cuota.monto_pagado);
      const pagadoNuevo = round2(updates.monto_pagado);
      const fechaPagoActual = cuota.fecha_pago ? new Date(cuota.fecha_pago).getTime() : null;
      const fechaPagoNueva = updates.fecha_pago ? new Date(updates.fecha_pago).getTime() : null;
      return estadoActual !== estadoNuevo
        || totalActual !== totalNuevo
        || pagadoActual !== pagadoNuevo
        || fechaPagoActual !== fechaPagoNueva;
    });

    if (cuotasNecesitanCambio.length > 0 || prestamoNecesitaCambio) {
      incidencias += cuotasNecesitanCambio.length + (prestamoNecesitaCambio ? 1 : 0);
      console.log(`Préstamo ${prestamo.id}: ${cuotasNecesitanCambio.length} cuotas con cambios, estado ${prestamo.status} -> ${estado}`);

      if (verbose) {
        cuotasNecesitanCambio.forEach(({ cuota, updates }) => {
          console.log(
            `  Cuota ${cuota.id}: estado ${cuota.estado} -> ${updates.estado}, ` +
            `monto_total ${round2(cuota.monto_total)} -> ${updates.monto_total}, ` +
            `monto_pagado ${round2(cuota.monto_pagado)} -> ${updates.monto_pagado}`
          );
        });
      }

      if (apply) {
        await sequelize.transaction(async (transaction) => {
          for (const { cuota, updates } of cuotasNecesitanCambio) {
            await cuota.update({
              monto_total: updates.monto_total,
              monto_pagado: updates.monto_pagado,
              estado: updates.estado,
              fecha_pago: updates.fecha_pago
            }, { transaction });
            cuotasActualizadas += 1;
          }

          if (prestamoNecesitaCambio) {
            await prestamo.update(cambiosPrestamo, { transaction });
            prestamosActualizados += 1;
          }
        });
      }
    }
  }

  console.log(JSON.stringify({
    apply,
    prestamos_revisados: prestamos.length,
    prestamos_actualizados: prestamosActualizados,
    cuotas_actualizadas: cuotasActualizadas,
    incidencias_detectadas: incidencias
  }, null, 2));

  await sequelize.close();
};

run().catch(async (error) => {
  console.error('Error conciliando cuotas:', error);
  try {
    await sequelize.close();
  } catch (_error) {
    // ignore
  }
  process.exit(1);
});
