const DEFAULT_FROM = process.env.SMTP_FROM || process.env.EMAIL_FROM || 'no-reply@crediflash.local';
const APP_NAME = process.env.APP_NAME || 'CrediFlash';

const createTransporter = async () => {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_error) {
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

const sendOtpVerificationEmail = async ({ to, codigo, expiresInMinutes = 10 }) => {
  if (!to) {
    throw new Error('Email destinatario requerido');
  }

  const transporter = await createTransporter();
  const subject = `${APP_NAME} - Código de verificación`;
  const text = [
    `Tu código de verificación es: ${codigo}`,
    `Expira en ${expiresInMinutes} minutos.`,
    '',
    `Equipo ${APP_NAME}`
  ].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937;">
      <h2>Código de verificación</h2>
      <p>Tu código de verificación es:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 2px;">${codigo}</p>
      <p>Expira en ${expiresInMinutes} minutos.</p>
      <p style="margin-top: 16px;">Equipo ${APP_NAME}</p>
    </div>
  `;

  return transporter.sendMail({
    from: DEFAULT_FROM,
    to,
    subject,
    text,
    html
  });
};

module.exports = {
  sendOtpVerificationEmail
};
