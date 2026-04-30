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
  const event = normalizeStatus(
    getByPath(payload, [
      "event",
      "event_name",
      "eventName",
      "event.custom_id",
      "event.customId",
      "webhook.event",
      "type"
    ])
  );

  if (["purchase_approved", "compra aprovada"].includes(event)) {
    return true;
  }

  const status = normalizeStatus(
    getByPath(payload, [
      "status",
      "data.status",
      "sale.status",
      "order.status",
      "payment.status",
      "data.payment.status"
    ])
  );

  return ["paid", "approved", "aprovado", "pago", "completed", "complete"].includes(status);
}

function mapCaktoPayload(payload) {
  return {
    saleId: String(
      getByPath(payload, [
        "id",
        "data.id",
        "data.refId",
        "data.ref_id",
        "data.orderId",
        "sale.id",
        "order.id",
        "transaction.id",
        "payment.id"
      ]) ||
        crypto.randomUUID()
    ),
    status:
      getByPath(payload, [
        "status",
        "data.status",
        "sale.status",
        "order.status",
        "payment.status",
        "data.payment.status"
      ]) ||
      "unknown",
    customerName: getByPath(payload, [
      "data.customer.name",
      "customer.name",
      "client.name",
      "buyer.name",
      "sale.customer.name"
    ]),
    customerEmail: getByPath(payload, [
      "data.customer.email",
      "customer.email",
      "client.email",
      "buyer.email",
      "sale.customer.email"
    ]),
    productName: getByPath(payload, [
      "data.product.name",
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

function maskEmail(email) {
  if (!email || !email.includes("@")) {
    return "email-nao-informado";
  }

  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}

function isLikelyTestEvent(payload) {
  const event = normalizeStatus(
    getByPath(payload, ["event", "event_name", "eventName", "type", "webhook.event"])
  );

  const isTestFlag = Boolean(
    getByPath(payload, ["test", "is_test", "isTest", "webhook.test", "sandbox"])
  );

  return isTestFlag || event.includes("test") || event.includes("teste");
}

router.get("/", (req, res) => {
  if (!hasValidWebhookSecret(req)) {
    return res.status(401).json({ error: "Webhook nao autorizado." });
  }

  return res.json({
    ok: true,
    message: "Webhook da Cakto ativo. Use POST para eventos reais."
  });
});

router.post("/", async (req, res) => {
  console.log("[cakto:webhook] Recebido webhook da Cakto.");

  try {
    if (!hasValidWebhookSecret(req)) {
      console.warn("[cakto:webhook] Bloqueado: segredo invalido.");
      return res.status(401).json({ error: "Webhook nao autorizado." });
    }

    console.log("[cakto:webhook] Segredo validado.");

    if (!isApprovedPurchase(req.body)) {
      console.log("[cakto:webhook] Ignorado: evento/status nao e compra aprovada.");
      return res.json({ ignored: true, reason: "Compra ainda nao aprovada." });
    }

    const purchase = mapCaktoPayload(req.body);
    const expectedProduct = process.env.CAKTO_PRODUCT_NAME;

    console.log("[cakto:webhook] Compra aprovada recebida.", {
      saleId: purchase.saleId,
      productName: purchase.productName || "produto-nao-informado",
      customerEmail: maskEmail(purchase.customerEmail),
      status: purchase.status
    });

    if (
      expectedProduct &&
      purchase.productName &&
      purchase.productName.toLowerCase() !== expectedProduct.toLowerCase()
    ) {
      console.log("[cakto:webhook] Ignorado: produto diferente do esperado.", {
        expectedProduct,
        receivedProduct: purchase.productName
      });

      return res.json({ ignored: true, reason: "Produto diferente do esperado." });
    }

    if (!purchase.customerEmail) {
      console.warn("[cakto:webhook] Erro: email do cliente nao veio no payload.");
      console.warn("[cakto:webhook] Payload recebido:", JSON.stringify(req.body));

      if (isLikelyTestEvent(req.body)) {
        console.log("[cakto:webhook] Teste recebido sem email. Respondendo 200 para validar URL.");
        return res.json({
          ok: true,
          test: true,
          warning: "Teste recebido, mas sem email do cliente no payload."
        });
      }

      return res.status(400).json({ error: "Email do cliente nao encontrado no payload." });
    }

    const existingPurchase = await prisma.purchase.findUnique({
      where: { caktoSaleId: purchase.saleId }
    });

    if (existingPurchase) {
      console.log("[cakto:webhook] Ignorado: compra ja processada.", {
        saleId: purchase.saleId
      });

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
      console.log("[cakto:webhook] Usuario criado no Neon.", {
        userId: user.id,
        email: maskEmail(email)
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
      console.log("[cakto:webhook] Usuario existente teve acesso liberado.", {
        userId: user.id,
        email: maskEmail(email)
      });
    } else {
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: purchase.customerName,
          hasAccess: true
        }
      });
      console.log("[cakto:webhook] Usuario ja tinha acesso; dados atualizados.", {
        userId: user.id,
        email: maskEmail(email)
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

    console.log("[cakto:webhook] Compra registrada no Neon.", {
      saleId: purchase.saleId,
      userId: user.id
    });

    if (passwordToSend) {
      await sendAccessEmail({
        to: email,
        name: purchase.customerName,
        password: passwordToSend
      });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          accessEmailSent: true,
          accessEmailSentAt: new Date()
        }
      });

      console.log("[cakto:webhook] Email de acesso enviado.", {
        email: maskEmail(email)
      });
    } else {
      console.log("[cakto:webhook] Email nao enviado: usuario ja possuia acesso.");
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("[cakto:webhook] Falha ao processar webhook.", {
      message: error.message,
      code: error.code,
      stack: error.stack
    });

    return res.status(500).json({
      error: "Falha ao processar webhook da Cakto.",
      message: error.message
    });
  }
});

module.exports = router;
