const DEFAULT_FROM = process.env.SMTP_FROM || process.env.EMAIL_FROM || 'no-reply@crediflash.local';
const APP_NAME = process.env.APP_NAME || 'CreditFlash';
const DEFAULT_BCC = process.env.SMTP_BCC || 'creditflashadmin@gmail.com';
const { formatMMDDYYYY } = require('./dateFormat');

const formatUsd = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '$0.00';
  return parsed.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const buildCuotaReminderTemplate = ({ clienteNombre, fechaVencimiento, montoTotal }) => {
  const subject = `${APP_NAME} - Recordatorio de cuota por vencer`;
  const fechaTexto = formatMMDDYYYY(fechaVencimiento);
  const montoTexto = formatUsd(montoTotal);

  const text = [
    `Hola ${clienteNombre || 'cliente'},`,
    '',
    'Te recordamos que tu cuota está próxima a vencer.',
    `• Fecha de vencimiento: ${fechaTexto}`,
    `• Monto de la cuota: ${montoTexto}`,
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
  montoTotal
}) => {
  if (!to) {
    throw new Error('El cliente no tiene correo electrónico');
  }

  const transporter = await createTransporter();
  const { subject, text, html } = buildCuotaReminderTemplate({
    clienteNombre,
    fechaVencimiento,
    montoTotal
  });

  return transporter.sendMail({
    from: `"${APP_NAME}" <${DEFAULT_FROM}>`,
    to,
    bcc: DEFAULT_BCC,
    subject,
    text,
    html
  });
};

const sendMailWithReportCsv = async ({
  to,
  subject,
  text,
  filename,
  fileBuffer
}) => {
  if (!to) {
    throw new Error('No se encontró correo destino para el reporte');
  }
  if (!fileBuffer || !filename) {
    throw new Error('No se encontró adjunto CSV para el reporte');
  }

  const transporter = await createTransporter();
  return transporter.sendMail({
    from: DEFAULT_FROM,
    to,
    bcc: DEFAULT_BCC,
    subject,
    text,
    attachments: [
      {
        filename,
        content: fileBuffer,
        contentType: 'text/csv'
      }
    ]
  });
};

module.exports = {
  sendCuotaReminderEmail,
  sendMailWithReportCsv
};
