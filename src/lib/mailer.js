const nodemailer = require("nodemailer");

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendAccessEmail({ to, name, password }) {
  const transporter = createTransporter();
  const loginUrl = process.env.APP_URL || "http://localhost:3000";
  const firstName = name ? name.split(" ")[0] : "tudo bem";

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: "Seu acesso ao Pack do Criador",
    text: [
      `Ola, ${firstName}!`,
      "",
      "Sua compra foi aprovada e seu acesso foi liberado.",
      "",
      `Login: ${to}`,
      `Senha temporaria: ${password}`,
      `Acesse: ${loginUrl}`,
      "",
      "Por seguranca, altere sua senha depois do primeiro login."
    ].join("\n"),
    html: `
      <p>Ola, ${firstName}!</p>
      <p>Sua compra foi aprovada e seu acesso foi liberado.</p>
      <p><strong>Login:</strong> ${to}</p>
      <p><strong>Senha temporaria:</strong> ${password}</p>
      <p><a href="${loginUrl}">Acessar produto</a></p>
      <p>Por seguranca, altere sua senha depois do primeiro login.</p>
    `
  });
}

module.exports = { sendAccessEmail };
