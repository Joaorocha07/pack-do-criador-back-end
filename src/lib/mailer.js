const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("Variaveis SMTP nao configuradas: SMTP_HOST, SMTP_USER e SMTP_PASS sao obrigatorios.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });
}

async function sendAccessEmail({ to, name, password }) {
  if (!process.env.MAIL_FROM) {
    throw new Error("Variavel MAIL_FROM nao configurada.");
  }

  const transporter = createTransporter();
  const appUrl = (process.env.APP_URL || "https://packdocriador.com").replace(/\/$/, "");
  const loginUrl = `${appUrl}/login`;
  const firstName = name ? name.split(" ")[0] : "tudo bem";
  const logoPath = path.resolve(process.cwd(), "android-chrome-512x512.png");
  const attachments = [];

  if (fs.existsSync(logoPath)) {
    attachments.push({
      filename: "android-chrome-512x512.png",
      path: logoPath,
      cid: "packdocriador-logo"
    });
  }

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
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Seu acesso ao Pack do Criador</title>
        </head>
        <body style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#0b0b0d;border:1px solid #262626;border-radius:16px;overflow:hidden;">
                  <tr>
                    <td style="padding:32px 32px 16px;text-align:center;">
                      <img src="cid:packdocriador-logo" width="88" height="88" alt="Pack do Criador" style="display:block;margin:0 auto 18px;border-radius:20px;" />
                      <p style="margin:0 0 8px;color:#a1a1aa;font-size:13px;letter-spacing:3px;text-transform:uppercase;">Acesso liberado</p>
                      <h1 style="margin:0;color:#ffffff;font-size:28px;line-height:1.2;">Bem-vindo ao Pack do Criador</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 32px 0;">
                      <p style="margin:0 0 18px;color:#d4d4d8;font-size:16px;line-height:1.6;">
                        Ola, ${firstName}! Sua compra foi aprovada e seu acesso ja esta pronto.
                      </p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111113;border:1px solid #2a2a2d;border-radius:12px;margin:20px 0;">
                        <tr>
                          <td style="padding:20px;">
                            <p style="margin:0 0 8px;color:#a1a1aa;font-size:13px;">Email de acesso</p>
                            <p style="margin:0 0 18px;color:#ffffff;font-size:18px;font-weight:700;word-break:break-all;">${to}</p>
                            <p style="margin:0 0 8px;color:#a1a1aa;font-size:13px;">Senha temporaria</p>
                            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:1px;">${password}</p>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 24px;color:#d4d4d8;font-size:15px;line-height:1.6;">
                        Use essa senha apenas para o primeiro acesso. Depois de entrar, altere sua senha para manter sua conta segura.
                      </p>
                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px;">
                        <tr>
                          <td bgcolor="#ffffff" style="border-radius:10px;">
                            <a href="${loginUrl}" style="display:inline-block;padding:15px 28px;color:#050505;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">
                              Acessar area de membros
                            </a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 8px;color:#a1a1aa;font-size:13px;line-height:1.5;text-align:center;">
                        Se o botao nao abrir, copie e cole este link no navegador:
                      </p>
                      <p style="margin:0 0 28px;color:#d4d4d8;font-size:13px;line-height:1.5;text-align:center;word-break:break-all;">
                        <a href="${loginUrl}" style="color:#ffffff;">${loginUrl}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    attachments
  });
}

module.exports = { sendAccessEmail };
