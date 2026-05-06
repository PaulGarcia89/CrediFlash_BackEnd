const {
  resolveLoanPaymentCounters,
  summarizeLoanQuotas,
  resolveAbonoParcialAcumulado
} = require('../../utils/prestamoAbonos');

const buildLoanSummary = (prestamo = {}) => {
  const counters = resolveLoanPaymentCounters(prestamo);
  return {
    pagosHechos: counters.pagosHechos,
    cuotasRestantes: counters.cuotasRestantes,
    saldoPendiente: counters.saldoPendiente,
    abonoParcialAcumulado: counters.abonoParcialAcumulado,
    resumenCuotas: summarizeLoanQuotas(Array.isArray(prestamo?.cuotas) ? prestamo.cuotas : []),
    abonoParcialPersistido: resolveAbonoParcialAcumulado(Array.isArray(prestamo?.cuotas) ? prestamo.cuotas : [])
  };
};

module.exports = {
  buildLoanSummary,
  resolveLoanPaymentCounters,
  summarizeLoanQuotas,
  resolveAbonoParcialAcumulado
};
