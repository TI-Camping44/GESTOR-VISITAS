import 'server-only'
// Envío de correos desde una cuenta de Google de la empresa (Gmail SMTP con contraseña de aplicación).
// SMTP_USER y SMTP_PASS solo en las variables de Vercel: nunca NEXT_PUBLIC_, nunca en el repo.
import nodemailer from 'nodemailer'

export const correoConfigurado = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS)

export async function enviarCorreo(m: { para: string; asunto: string; texto: string; html: string; responderA?: string; nombreRemitente?: string }) {
  if (!correoConfigurado()) throw new Error('Falta configurar el correo de envío (SMTP_USER y SMTP_PASS en Vercel).')
  const transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  await transporte.sendMail({
    from: { name: m.nombreRemitente ?? 'Visitas y Rutas', address: process.env.SMTP_USER! },
    to: m.para,
    replyTo: m.responderA,
    subject: m.asunto,
    text: m.texto,
    html: m.html,
  })
}
