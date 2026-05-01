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

function emailShell({ title, preview, content, attachments }) {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
      </head>
      <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preview}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e6eaf2;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(23,32,51,0.08);">
                <tr>
                  <td style="padding:28px 32px 18px;text-align:center;background:#ffffff;">
                    ${
                      attachments.length
                        ? '<img src="cid:packdocriador-logo" width="74" height="74" alt="Pack do Criador" style="display:block;margin:0 auto 16px;border-radius:18px;" />'
                        : ""
                    }
                    ${content.header}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 32px;">
                    ${content.body}
                  </td>
                </tr>
              </table>
              <p style="margin:18px 0 0;color:#7a8599;font-size:12px;line-height:1.5;text-align:center;">
                Pack do Criador
              </p>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function getLogoAttachment() {
  const logoPath = path.resolve(process.cwd(), "android-chrome-512x512.png");

  if (!fs.existsSync(logoPath)) {
    return [];
  }

  return [
    {
      filename: "android-chrome-512x512.png",
      path: logoPath,
      cid: "packdocriador-logo"
    }
  ];
}

async function sendAccessEmail({ to, name, password }) {
  if (!process.env.MAIL_FROM) {
    throw new Error("Variavel MAIL_FROM nao configurada.");
  }

  const transporter = createTransporter();
  const appUrl = (process.env.APP_URL || "https://packdocriador.com").replace(/\/$/, "");
  const loginUrl = `${appUrl}/login`;
  const firstName = name ? name.split(" ")[0] : "tudo bem";
  const attachments = getLogoAttachment();

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
    html: emailShell({
      title: "Seu acesso ao Pack do Criador",
      preview: "Sua compra foi aprovada e seu acesso ja esta pronto.",
      attachments,
      content: {
        header: `
          <p style="margin:0 0 8px;color:#5b6475;font-size:13px;letter-spacing:3px;text-transform:uppercase;">Acesso liberado</p>
          <h1 style="margin:0;color:#172033;font-size:28px;line-height:1.2;">Bem-vindo ao Pack do Criador</h1>
        `,
        body: `
          <p style="margin:0 0 18px;color:#3a4558;font-size:16px;line-height:1.6;">
            Ola, ${firstName}! Sua compra foi aprovada e seu acesso ja esta pronto.
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e6eaf2;border-radius:14px;margin:20px 0;">
            <tr>
              <td style="padding:20px;">
                <p style="margin:0 0 8px;color:#697386;font-size:13px;">Email de acesso</p>
                <p style="margin:0 0 18px;color:#172033;font-size:18px;font-weight:700;word-break:break-all;">${to}</p>
                <p style="margin:0 0 8px;color:#697386;font-size:13px;">Senha temporaria</p>
                <p style="margin:0;color:#172033;font-size:22px;font-weight:700;letter-spacing:1px;">${password}</p>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 24px;color:#3a4558;font-size:15px;line-height:1.6;">
            Use essa senha apenas para o primeiro acesso. Depois de entrar, altere sua senha para manter sua conta segura.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px;">
            <tr>
              <td bgcolor="#111827" style="border-radius:10px;">
                <a href="${loginUrl}" style="display:inline-block;padding:15px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">
                  Acessar area de membros
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;color:#697386;font-size:13px;line-height:1.5;text-align:center;">
            Se o botao nao abrir, copie e cole este link no navegador:
          </p>
          <p style="margin:0;color:#3a4558;font-size:13px;line-height:1.5;text-align:center;word-break:break-all;">
            <a href="${loginUrl}" style="color:#2563eb;">${loginUrl}</a>
          </p>
        `
      }
    }),
    attachments
  });
}

async function sendDeviceBlockedEmail({ to, name }) {
  if (!process.env.MAIL_FROM) {
    throw new Error("Variavel MAIL_FROM nao configurada.");
  }

  const transporter = createTransporter();
  const appUrl = (process.env.APP_URL || "https://packdocriador.com").replace(/\/$/, "");
  const loginUrl = `${appUrl}/login`;
  const firstName = name ? name.split(" ")[0] : "tudo bem";
  const attachments = getLogoAttachment();

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: "Tentativa de acesso bloqueada no Pack do Criador",
    text: [
      `Ola, ${firstName}!`,
      "",
      "Detectamos uma tentativa de acesso ao Pack do Criador em um aparelho ou navegador diferente do cadastrado.",
      "",
      "Por seguranca, sua conta pode ser acessada apenas no aparelho e no navegador usados no primeiro acesso.",
      "Se voce trocou de aparelho, limpou os dados do navegador ou precisa liberar um novo acesso, fale com o suporte.",
      "",
      `Area de membros: ${loginUrl}`
    ].join("\n"),
    html: emailShell({
      title: "Tentativa de acesso bloqueada",
      preview: "Sua conta so pode ser acessada no aparelho e navegador cadastrados.",
      attachments,
      content: {
        header: `
          <p style="margin:0 0 8px;color:#b45309;font-size:13px;letter-spacing:3px;text-transform:uppercase;">Acesso bloqueado</p>
          <h1 style="margin:0;color:#172033;font-size:26px;line-height:1.25;">Seu acesso esta protegido</h1>
        `,
        body: `
          <p style="margin:0 0 18px;color:#3a4558;font-size:16px;line-height:1.6;">
            Ola, ${firstName}! Detectamos uma tentativa de entrada em um aparelho ou navegador diferente do cadastrado.
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;margin:20px 0;">
            <tr>
              <td style="padding:20px;">
                <p style="margin:0;color:#7c2d12;font-size:15px;line-height:1.6;">
                  Por seguranca, sua conta pode ser usada apenas no aparelho e no navegador onde o primeiro acesso foi realizado.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 22px;color:#3a4558;font-size:15px;line-height:1.6;">
            Se voce trocou de aparelho, reinstalou o navegador, limpou os dados do site ou acredita que isso foi um engano, fale com o suporte para resetarmos o aparelho vinculado.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
            <tr>
              <td bgcolor="#111827" style="border-radius:10px;">
                <a href="${loginUrl}" style="display:inline-block;padding:15px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">
                  Voltar para a area de membros
                </a>
              </td>
            </tr>
          </table>
        `
      }
    }),
    attachments
  });
}

async function sendDeviceResetEmail({ to, name }) {
  if (!process.env.MAIL_FROM) {
    throw new Error("Variavel MAIL_FROM nao configurada.");
  }

  const transporter = createTransporter();
  const appUrl = (process.env.APP_URL || "https://packdocriador.com").replace(/\/$/, "");
  const loginUrl = `${appUrl}/login`;
  const firstName = name ? name.split(" ")[0] : "tudo bem";
  const attachments = getLogoAttachment();

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: "Seu aparelho foi resetado no Pack do Criador",
    text: [
      `Ola, ${firstName}!`,
      "",
      "O aparelho vinculado a sua conta foi resetado.",
      "",
      "Agora voce pode fazer login novamente. Por seguranca, use o mesmo aparelho e o mesmo navegador que deseja manter vinculado a conta.",
      "",
      "Depois do proximo acesso, sua conta ficara vinculada a esse aparelho/navegador.",
      "",
      `Acesse: ${loginUrl}`
    ].join("\n"),
    html: emailShell({
      title: "Aparelho resetado",
      preview: "Seu aparelho foi resetado e voce ja pode fazer login novamente.",
      attachments,
      content: {
        header: `
          <p style="margin:0 0 8px;color:#2563eb;font-size:13px;letter-spacing:3px;text-transform:uppercase;">Aparelho resetado</p>
          <h1 style="margin:0;color:#172033;font-size:26px;line-height:1.25;">Voce ja pode fazer login novamente</h1>
        `,
        body: `
          <p style="margin:0 0 18px;color:#3a4558;font-size:16px;line-height:1.6;">
            Ola, ${firstName}! O aparelho vinculado a sua conta foi resetado pelo suporte.
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;margin:20px 0;">
            <tr>
              <td style="padding:20px;">
                <p style="margin:0;color:#1e3a8a;font-size:15px;line-height:1.6;">
                  Faça o proximo login no mesmo aparelho e no mesmo navegador que voce deseja manter cadastrado. Depois desse acesso, sua conta ficara vinculada a ele novamente.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 22px;color:#3a4558;font-size:15px;line-height:1.6;">
            Se voce trocar de navegador, limpar os dados do site ou entrar por outro aparelho, o acesso pode ser bloqueado de novo por seguranca.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
            <tr>
              <td bgcolor="#111827" style="border-radius:10px;">
                <a href="${loginUrl}" style="display:inline-block;padding:15px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">
                  Fazer login
                </a>
              </td>
            </tr>
          </table>
        `
      }
    }),
    attachments
  });
}

module.exports = { sendAccessEmail, sendDeviceBlockedEmail, sendDeviceResetEmail };
