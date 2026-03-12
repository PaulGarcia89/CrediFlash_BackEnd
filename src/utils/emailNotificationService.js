const DEFAULT_FROM = process.env.SMTP_FROM || process.env.EMAIL_FROM || 'no-reply@crediflash.local';
const APP_NAME = process.env.APP_NAME || 'CrediFlash';
const DEFAULT_BCC = process.env.SMTP_BCC || 'creditflashadmin@gmail.com';

const buildCuotaReminderTemplate = ({ clienteNombre, fechaVencimiento, montoTotal, cuotaId }) => {
  const subject = `${APP_NAME} - Recordatorio de cuota por vencer`;
  const fecha = new Date(fechaVencimiento);
  const fechaTexto = Number.isNaN(fecha.getTime()) ? String(fechaVencimiento) : fecha.toLocaleDateString('es-DO');
  const montoTexto = Number.isFinite(Number(montoTotal))
    ? Number(montoTotal).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(montoTotal || '0.00');

  const text = [
    `Hola ${clienteNombre || 'cliente'},`,
    '',
    'Te recordamos que tu cuota está próxima a vencer.',
    `Fecha de vencimiento: ${fechaTexto}`,
    `Monto de la cuota: ${montoTexto}`,
    `Referencia cuota: ${cuotaId}`,
    '',
    'Si ya realizaste el pago, ignora este mensaje.',
    '',
    `Equipo ${APP_NAME}`
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937;">
      <h2 style="margin-bottom: 8px;">Recordatorio de cuota</h2>
      <p>Hola <strong>${clienteNombre || 'cliente'}</strong>,</p>
      <p>Te recordamos que tu cuota está próxima a vencer.</p>
      <ul>
        <li><strong>Fecha de vencimiento:</strong> ${fechaTexto}</li>
        <li><strong>Monto de la cuota:</strong> ${montoTexto}</li>
        <li><strong>Referencia cuota:</strong> ${cuotaId}</li>
      </ul>
      <p>Si ya realizaste el pago, ignora este mensaje.</p>
      <p style="margin-top: 16px;">Equipo ${APP_NAME}</p>
    </div>
  `;

  return { subject, text, html };
};

const buildCuotaReminderTemplateDetailed = ({
  clienteNombre,
  fechaVencimiento,
  montoTotalCuota,
  montoCredito,
  plazoSemanas,
  cuotasPendientes,
  tasaInteres
}) => {
  const subject = `${APP_NAME} - Recordatorio de cuota por vencer`;
  const fecha = new Date(fechaVencimiento);
  const fechaTexto = Number.isNaN(fecha.getTime()) ? String(fechaVencimiento) : fecha.toLocaleDateString('es-DO');

  const money = value =>
    Number.isFinite(Number(value))
      ? Number(value).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '0.00';

  const text = [
    `Hola ${clienteNombre || 'cliente'},`,
    '',
    'Te recordamos que tu cuota está próxima a vencer.',
    `Fecha de vencimiento: ${fechaTexto}`,
    `Monto de la cuota: ${money(montoTotalCuota)}`,
    '',
    'Detalle de tu crédito:',
    `- Monto del crédito: ${money(montoCredito)}`,
    `- Plazo total: ${Number(plazoSemanas || 0)} semanas`,
    `- Cuotas pendientes: ${Number(cuotasPendientes || 0)}`,
    `- Tasa de interés: ${Number(tasaInteres || 0).toFixed(2)}%`,
    '',
    'Si ya realizaste el pago, ignora este mensaje.',
    '',
    `Equipo ${APP_NAME}`
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937;">
      <h2 style="margin-bottom: 8px;">Recordatorio de cuota</h2>
      <p>Hola <strong>${clienteNombre || 'cliente'}</strong>,</p>
      <p>Te recordamos que tu cuota está próxima a vencer.</p>
      <ul>
        <li><strong>Fecha de vencimiento:</strong> ${fechaTexto}</li>
        <li><strong>Monto de la cuota:</strong> ${money(montoTotalCuota)}</li>
      </ul>
      <p><strong>Detalle de tu crédito:</strong></p>
      <ul>
        <li><strong>Monto del crédito:</strong> ${money(montoCredito)}</li>
        <li><strong>Plazo total:</strong> ${Number(plazoSemanas || 0)} semanas</li>
        <li><strong>Cuotas pendientes:</strong> ${Number(cuotasPendientes || 0)}</li>
        <li><strong>Tasa de interés:</strong> ${Number(tasaInteres || 0).toFixed(2)}%</li>
      </ul>
      <p>Si ya realizaste el pago, ignora este mensaje.</p>
      <p style="margin-top: 16px;">Equipo ${APP_NAME}</p>
    </div>
  `;

  return { subject, text, html };
};

const createTransporter = async () => {
  let nodemailer;
  try {
    // Carga diferida para no romper el arranque si aún no está instalado
    nodemailer = require('nodemailer');
  } catch (error) {
    throw new Error('Falta dependencia nodemailer. Ejecuta: npm install nodemailer');
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    throw new Error('Faltan variables SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
};

const sendCuotaReminderEmail = async ({
  to,
  clienteNombre,
  fechaVencimiento,
  montoTotal,
  cuotaId,
  montoCredito,
  plazoSemanas,
  cuotasPendientes,
  tasaInteres
}) => {
  if (!to) {
    throw new Error('El cliente no tiene correo electrónico');
  }

  const transporter = await createTransporter();
  const templatePayload = {
    clienteNombre,
    fechaVencimiento,
    montoTotalCuota: montoTotal,
    montoCredito,
    plazoSemanas,
    cuotasPendientes,
    tasaInteres
  };
  const hasDetailedData =
    montoCredito !== undefined || plazoSemanas !== undefined || cuotasPendientes !== undefined || tasaInteres !== undefined;

  const { subject, text, html } = hasDetailedData
    ? buildCuotaReminderTemplateDetailed(templatePayload)
    : buildCuotaReminderTemplate({ clienteNombre, fechaVencimiento, montoTotal, cuotaId });

  return transporter.sendMail({
    from: DEFAULT_FROM,
    to,
    bcc: DEFAULT_BCC,
    subject,
    text,
    html
  });
};

module.exports = {
  sendCuotaReminderEmail
};
