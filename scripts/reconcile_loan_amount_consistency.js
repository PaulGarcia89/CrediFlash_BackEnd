require('dotenv').config();

const { sequelize } = require('../src/models');

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const verbose = args.has('--verbose');
const targetLoanId = (() => {
  const index = process.argv.indexOf('--prestamo-id');
  return index >= 0 ? process.argv[index + 1] : null;
})();

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const buildExpectedLoanSummary = (row = {}) => {
  const montoSolicitado = round2(row.monto_solicitado);
  const interes = round2(row.interes);
  const numSemanas = Number(row.num_semanas) || 0;
  const totalPagar = round2(montoSolicitado + (montoSolicitado * interes / 100));
  const pagosSemanales = numSemanas > 0 ? round2(totalPagar / numSemanas) : totalPagar;

  return {
    montoSolicitado,
    interes,
    totalPagar,
    pagosSemanales,
    ganancias: round2(totalPagar - montoSolicitado)
  };
};

const getErrorMessage = (error) => {
  return error?.original?.message
    || error?.parent?.message
    || error?.message
    || 'Error desconocido';
};

const main = async () => {
  await sequelize.authenticate();

  const whereLoan = targetLoanId
    ? 'AND p.id = :prestamoId'
    : '';

  const prestamos = await sequelize.query(
    `
      SELECT
        p.id,
        p.monto_solicitado,
        p.interes,
        p.num_semanas,
        p.total_pagar,
        p.pagos_semanales,
        p.ganancias,
        c.monto_referido
      FROM public.prestamos p
      INNER JOIN public.solicitudes s ON s.id = p.solicitud_id
      INNER JOIN public.clientes c ON c.id = s.cliente_id
      WHERE p.num_semanas IS NOT NULL
        AND p.num_semanas > 0
        ${whereLoan}
    `,
    {
      replacements: targetLoanId ? { prestamoId: targetLoanId } : undefined,
      type: sequelize.QueryTypes.SELECT
    }
  );

  const inconsistentes = prestamos
    .map((row) => {
      const expected = buildExpectedLoanSummary(row);
      const actualTotal = round2(row.total_pagar);
      const actualWeekly = round2(row.pagos_semanales);
      const totalDiff = round2(actualTotal - expected.totalPagar);
      const weeklyDiff = round2(actualWeekly - expected.pagosSemanales);

      return {
        id: row.id,
        expected,
        actualTotal,
        actualWeekly,
        montoReferido: round2(row.monto_referido),
        totalDiff,
        weeklyDiff,
        requiereActualizacion: Math.abs(totalDiff) >= 0.01 || Math.abs(weeklyDiff) >= 0.01
      };
    })
    .filter((item) => item.requiereActualizacion);

  console.log(`Préstamos revisados: ${prestamos.length}`);
  console.log(`Préstamos inconsistentes: ${inconsistentes.length}`);

  if (!applyChanges) {
    if (verbose) {
      inconsistentes.slice(0, 50).forEach((item) => {
        console.log(
          `- ${item.id}: total=${item.actualTotal} -> ${item.expected.totalPagar}, semanal=${item.actualWeekly} -> ${item.expected.pagosSemanales}`
        );
      });
    }

    console.log('Ejecuta con --apply para corregir los préstamos y cuotas.');
    await sequelize.close();
    return;
  }

  let procesados = 0;
  let fallidos = 0;

  for (const item of inconsistentes) {
    try {
      const cuotas = await sequelize.query(
        `
          SELECT id, monto_total, monto_capital, monto_interes, monto_pagado, estado, fecha_pago, observaciones
          FROM public.cuotas
          WHERE prestamo_id = :prestamoId
          ORDER BY fecha_vencimiento ASC, id ASC
        `,
        {
          replacements: { prestamoId: item.id },
          type: sequelize.QueryTypes.SELECT
        }
      );

      const discountAmount = Math.min(
        round2(item.montoReferido || 0),
        item.expected.pagosSemanales,
        Math.max(round2(item.expected.totalPagar - item.actualTotal), 0) || item.expected.pagosSemanales
      );

      if (cuotas.length > 0 && discountAmount > 0) {
        const ultimaCuota = cuotas[cuotas.length - 1];
        const montoTotalBase = round2(ultimaCuota.monto_total || item.expected.pagosSemanales);
        const interesUltimaCuota = round2(ultimaCuota.monto_interes || 0);
        const capitalUltimaCuota = round2(ultimaCuota.monto_capital || 0);
        const interesReducido = Math.min(interesUltimaCuota, discountAmount);
        const capitalReducido = round2(discountAmount - interesReducido);

        const nuevoMontoTotal = round2(Math.max(montoTotalBase - discountAmount, 0));
        const nuevoMontoCapital = round2(Math.max(capitalUltimaCuota - capitalReducido, 0));
        const nuevoMontoInteres = round2(Math.max(interesUltimaCuota - interesReducido, 0));

        if (applyChanges) {
          await sequelize.query(
            `
              UPDATE public.cuotas
              SET monto_total = :montoTotal,
                  monto_capital = :montoCapital,
                  monto_interes = :montoInteres,
                  observaciones = CASE
                    WHEN observaciones IS NULL OR observaciones = ''
                      THEN :observacion
                    ELSE observaciones || E'\n' || :observacion
                  END
              WHERE id = :cuotaId
            `,
            {
              replacements: {
                cuotaId: ultimaCuota.id,
                montoTotal: nuevoMontoTotal,
                montoCapital: nuevoMontoCapital,
                montoInteres: nuevoMontoInteres,
                observacion: `Descuento referido aplicado: -${discountAmount.toFixed(2)} USD`
              }
            }
          );
        }
      }

      procesados += 1;

      if (verbose) {
        console.log(`Actualizado ${item.id}`);
      }
    } catch (error) {
      fallidos += 1;
      console.error(`No se pudo reconciliar el préstamo ${item.id}: ${getErrorMessage(error)}`);
    }
  }

  console.log(`Reconciliación terminada. Procesados=${procesados}, fallidos=${fallidos}.`);
  await sequelize.close();
};

main().catch((error) => {
  console.error('Error reconciliando montos de préstamo:', error);
  sequelize.close().finally(() => process.exit(1));
});
