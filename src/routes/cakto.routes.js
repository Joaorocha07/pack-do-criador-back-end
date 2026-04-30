const express = require("express");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { generateTemporaryPassword, hashPassword } = require("../lib/password");
const { sendAccessEmail } = require("../lib/mailer");

const router = express.Router();

function getByPath(source, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], source);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isApprovedPurchase(payload) {
  const status = normalizeStatus(
    getByPath(payload, ["status", "sale.status", "order.status", "payment.status"])
  );

  return ["paid", "approved", "aprovado", "pago", "completed", "complete"].includes(status);
}

function mapCaktoPayload(payload) {
  return {
    saleId: String(
      getByPath(payload, ["id", "sale.id", "order.id", "transaction.id", "payment.id"]) ||
        crypto.randomUUID()
    ),
    status:
      getByPath(payload, ["status", "sale.status", "order.status", "payment.status"]) ||
      "unknown",
    customerName: getByPath(payload, [
      "customer.name",
      "client.name",
      "buyer.name",
      "sale.customer.name"
    ]),
    customerEmail: getByPath(payload, [
      "customer.email",
      "client.email",
      "buyer.email",
      "sale.customer.email"
    ]),
    productName: getByPath(payload, [
      "product.name",
      "product.title",
      "sale.product.name",
      "items.0.name"
    ])
  };
}

function hasValidWebhookSecret(req) {
  const expectedSecret = process.env.CAKTO_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return true;
  }

  const receivedSecret =
    req.headers["x-cakto-secret"] ||
    req.headers["x-webhook-secret"] ||
    req.query.secret;

  return receivedSecret === expectedSecret;
}

router.post("/", async (req, res) => {
  if (!hasValidWebhookSecret(req)) {
    return res.status(401).json({ error: "Webhook nao autorizado." });
  }

  if (!isApprovedPurchase(req.body)) {
    return res.json({ ignored: true, reason: "Compra ainda nao aprovada." });
  }

  const purchase = mapCaktoPayload(req.body);
  const expectedProduct = process.env.CAKTO_PRODUCT_NAME;

  if (
    expectedProduct &&
    purchase.productName &&
    purchase.productName.toLowerCase() !== expectedProduct.toLowerCase()
  ) {
    return res.json({ ignored: true, reason: "Produto diferente do esperado." });
  }

  if (!purchase.customerEmail) {
    return res.status(400).json({ error: "Email do cliente nao encontrado no payload." });
  }

  const existingPurchase = await prisma.purchase.findUnique({
    where: { caktoSaleId: purchase.saleId }
  });

  if (existingPurchase) {
    return res.json({ ok: true, duplicate: true });
  }

  const email = purchase.customerEmail.toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });
  let passwordToSend = null;
  let user = existingUser;

  if (!existingUser) {
    passwordToSend = generateTemporaryPassword();
    user = await prisma.user.create({
      data: {
        email,
        name: purchase.customerName,
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
        name: purchase.customerName,
        passwordHash: await hashPassword(passwordToSend),
        hasAccess: true,
        temporaryPassword: true
      }
    });
  } else {
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: purchase.customerName,
        hasAccess: true
      }
    });
  }

  await prisma.purchase.create({
    data: {
      caktoSaleId: purchase.saleId,
      productName: purchase.productName,
      customerName: purchase.customerName,
      customerEmail: email,
      status: purchase.status,
      rawPayload: req.body,
      userId: user.id
    }
  });

  if (passwordToSend) {
    await sendAccessEmail({
      to: email,
      name: purchase.customerName,
      password: passwordToSend
    });
  }

  return res.json({ ok: true });
});

module.exports = router;
