const express = require("express");
const prisma = require("../lib/prisma");
const { listCaktoOrders } = require("../lib/cakto-api");
const { generateTemporaryPassword, hashPassword } = require("../lib/password");
const { sendAccessEmail } = require("../lib/mailer");
const { requireAdmin, requireAuth } = require("../middlewares/auth");

const router = express.Router();

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function requireAdminImportSecret(req, res, next) {
  const expectedSecret = process.env.ADMIN_IMPORT_SECRET || process.env.CAKTO_WEBHOOK_SECRET;
  const receivedSecret = req.headers["x-admin-secret"] || req.query.secret;

  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return res.status(401).json({ error: "Importacao nao autorizada." });
  }

  return next();
}

function userResponse(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    hasAccess: user.hasAccess,
    temporaryPassword: user.temporaryPassword,
    accessEmailSent: user.accessEmailSent,
    accessEmailSentAt: user.accessEmailSentAt
  };
}

function isPaidPackOrder(order) {
  const expectedProduct = normalize(process.env.CAKTO_PRODUCT_NAME || "Pack do Criador");
  const productName = normalize(order.product?.name);
  const status = normalize(order.status);

  return productName === expectedProduct && status === "paid";
}

async function importOrder(order, { sendEmail }) {
  const email = order.customer?.email?.toLowerCase();

  if (!email) {
    return { skipped: true, reason: "pedido-sem-email", orderId: order.id };
  }

  const existingPurchase = await prisma.purchase.findUnique({
    where: { caktoSaleId: order.id }
  });

  if (existingPurchase) {
    return { skipped: true, reason: "pedido-ja-importado", orderId: order.id, email };
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  let passwordToSend = null;
  let user = existingUser;

  if (!existingUser) {
    passwordToSend = generateTemporaryPassword();
    user = await prisma.user.create({
      data: {
        email,
        name: order.customer?.name,
        role: "USER",
        passwordHash: await hashPassword(passwordToSend),
        hasAccess: true,
        temporaryPassword: true
      }
    });
  } else if (!existingUser.hasAccess) {
    passwordToSend = generateTemporaryPassword();
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: order.customer?.name,
        passwordHash: await hashPassword(passwordToSend),
        hasAccess: true,
        temporaryPassword: true
      }
    });
  } else {
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: order.customer?.name,
        hasAccess: true
      }
    });
  }

  await prisma.purchase.create({
    data: {
      caktoSaleId: order.id,
      productName: order.product?.name,
      customerName: order.customer?.name,
      customerEmail: email,
      status: order.status,
      rawPayload: order,
      userId: user.id
    }
  });

  if (sendEmail && passwordToSend) {
    await sendAccessEmail({
      to: email,
      name: order.customer?.name,
      password: passwordToSend
    });

    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        accessEmailSent: true,
        accessEmailSentAt: new Date()
      }
    });
  }

  return {
    imported: true,
    orderId: order.id,
    email,
    userId: user.id,
    emailSent: Boolean(sendEmail && passwordToSend)
  };
}

router.post("/bootstrap-admin", requireAdminImportSecret, async (req, res) => {
  const email = req.body?.email?.toLowerCase();
  const password = req.body?.password;
  const name = req.body?.name || "Administrador";

  if (!email || !password || password.length < 8) {
    return res.status(400).json({
      error: "Informe email e password com no minimo 8 caracteres."
    });
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      role: "ADMIN",
      passwordHash: await hashPassword(password),
      hasAccess: true,
      temporaryPassword: false
    },
    update: {
      name,
      role: "ADMIN",
      passwordHash: await hashPassword(password),
      hasAccess: true,
      temporaryPassword: false
    }
  });

  return res.json({
    ok: true,
    user: userResponse(user)
  });
});

router.use(requireAuth, requireAdmin);

router.post("/import-cakto-purchases", async (req, res) => {
  const sendEmail = req.body?.sendEmail === true;
  const maxPages = Number(req.body?.maxPages || 20);

  console.log("[admin:import-cakto] Iniciando importacao.", { sendEmail, maxPages });

  try {
    const orders = await listCaktoOrders({ maxPages });
    const paidPackOrders = orders.filter(isPaidPackOrder);
    const results = [];

    for (const order of paidPackOrders) {
      results.push(await importOrder(order, { sendEmail }));
    }

    const summary = {
      totalOrdersRead: orders.length,
      paidPackOrders: paidPackOrders.length,
      imported: results.filter((result) => result.imported).length,
      skipped: results.filter((result) => result.skipped).length,
      emailsSent: results.filter((result) => result.emailSent).length
    };

    console.log("[admin:import-cakto] Importacao finalizada.", summary);

    return res.json({
      ok: true,
      summary,
      results
    });
  } catch (error) {
    console.error("[admin:import-cakto] Falha na importacao.", {
      message: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      error: "Falha ao importar compras da Cakto.",
      message: error.message
    });
  }
});

router.get("/users", async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      hasAccess: true,
      temporaryPassword: true,
      accessEmailSent: true,
      accessEmailSentAt: true
    }
  });

  return res.json({ ok: true, users });
});

router.post("/send-access-email", async (req, res) => {
  const email = req.body?.email?.toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "Informe o email do usuario." });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return res.status(404).json({ error: "Usuario nao encontrado." });
  }

  if (!user.hasAccess) {
    return res.status(400).json({ error: "Usuario ainda nao tem acesso liberado." });
  }

  const temporaryPassword = generateTemporaryPassword();
  let updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      temporaryPassword: true
    }
  });

  try {
    await sendAccessEmail({
      to: updatedUser.email,
      name: updatedUser.name,
      password: temporaryPassword
    });

    updatedUser = await prisma.user.update({
      where: { id: updatedUser.id },
      data: {
        accessEmailSent: true,
        accessEmailSentAt: new Date()
      }
    });

    console.log("[admin:send-access-email] Email de acesso enviado.", {
      userId: updatedUser.id,
      email: updatedUser.email
    });

    return res.json({
      ok: true,
      user: userResponse(updatedUser)
    });
  } catch (error) {
    console.error("[admin:send-access-email] Falha ao enviar email.", {
      userId: updatedUser.id,
      email: updatedUser.email,
      message: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      error: "Falha ao enviar email de acesso.",
      message: error.message
    });
  }
});

module.exports = router;
