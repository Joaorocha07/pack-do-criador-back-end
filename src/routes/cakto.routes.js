const express = require("express");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { generateTemporaryPassword, hashPassword } = require("../lib/password");
const { sendAccessEmail } = require("../lib/mailer");

const router = express.Router();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function ensureUserProfile(user) {
  return prisma.userProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      role: user.role || "USER"
    },
    update: {}
  });
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
      await ensureUserProfile(user);
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
      await ensureUserProfile(user);
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
      await ensureUserProfile(user);
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

router.get("/imports/cakto/paid-orders-batch", async (req, res) => {
  const secret = req.query.secret;
  const expectedSecret = process.env.CAKTO_WEBHOOK_SECRET || process.env.ADMIN_IMPORT_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(401).json({ error: "Importacao nao autorizada." });
  }

  // Set response timeout to 5 minutes for long-running import
  req.setTimeout(300000);
  res.setTimeout(300000);

  try {
    console.log("[cakto:batch-import] Iniciando importacao em lotes de 20 pedidos.");

    // Get all paid orders from Cakto API
    const { listCaktoOrders } = require("../lib/cakto-api");
    const orders = await listCaktoOrders({ maxPages: 20 });

    // Filter for paid orders
    const paidOrders = orders.filter(order => {
      const status = String(order.status || "").toLowerCase();
      const productName = String(order.product?.name || "").toLowerCase();
      const expectedProduct = String(process.env.CAKTO_PRODUCT_NAME || "").toLowerCase();

      return (
        ["paid", "approved", "aprovado", "pago", "completed"].includes(status) &&
        (!expectedProduct || productName === expectedProduct)
      );
    });

    console.log("[cakto:batch-import] Total de pedidos pagos encontrados:", paidOrders.length);

    const results = {
      totalOrders: paidOrders.length,
      processedBatches: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      batches: []
    };

    // Process in batches of 20
    const BATCH_SIZE = 20;
    for (let i = 0; i < paidOrders.length; i += BATCH_SIZE) {
      const batch = paidOrders.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(paidOrders.length / BATCH_SIZE);

      console.log(`[cakto:batch-import] Processando lote ${batchNumber}/${totalBatches} (${batch.length} pedidos)`);

      const batchResults = {
        batchNumber,
        size: batch.length,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: []
      };

      // Process each order in the batch
      for (const order of batch) {
        try {
          const email = order.customer?.email?.toLowerCase();

          if (!email) {
            batchResults.skipped++;
            results.skipped++;
            continue;
          }

          // Check if order already imported
          const existingPurchase = await prisma.purchase.findUnique({
            where: { caktoSaleId: order.id }
          });

          if (existingPurchase) {
            batchResults.skipped++;
            results.skipped++;
            continue;
          }

          // Check if user exists
          const existingUser = await prisma.user.findUnique({ where: { email } });
          let passwordToSend = null;
          let user = existingUser;

          if (!existingUser) {
            passwordToSend = generateTemporaryPassword();
            user = await prisma.user.create({
              data: {
                email,
                name: order.customer?.name,
                passwordHash: await hashPassword(passwordToSend),
                hasAccess: true,
                temporaryPassword: true
              }
            });
            await ensureUserProfile(user);
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
            await ensureUserProfile(user);
          } else {
            user = await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                name: order.customer?.name,
                hasAccess: true
              }
            });
            await ensureUserProfile(user);
          }

          // Create purchase record
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

          // Send access email if new user
          if (passwordToSend) {
            try {
              await sendAccessEmail({
                to: email,
                name: order.customer?.name,
                password: passwordToSend
              });

              await prisma.user.update({
                where: { id: user.id },
                data: {
                  accessEmailSent: true,
                  accessEmailSentAt: new Date()
                }
              });
            } catch (emailError) {
              console.warn("[cakto:batch-import] Falha ao enviar email.", {
                email,
                error: emailError.message
              });
            }
          }

          batchResults.imported++;
          results.imported++;
        } catch (error) {
          console.error("[cakto:batch-import] Erro ao processar pedido.", {
            orderId: order.id,
            error: error.message
          });
          batchResults.failed++;
          batchResults.errors.push({
            orderId: order.id,
            error: error.message
          });
          results.failed++;
        }
      }

      results.batches.push(batchResults);
      results.processedBatches++;

      console.log(`[cakto:batch-import] Lote ${batchNumber} concluído:`, batchResults);

      // Wait 2 seconds between batches to avoid rate limiting
      if (i + BATCH_SIZE < paidOrders.length) {
        await sleep(2000);
      }
    }

    console.log("[cakto:batch-import] Importacao finalizada com sucesso!", results);

    return res.json({
      ok: true,
      message: `✅ Importação concluída! ${results.imported} pedidos importados, ${results.skipped} ignorados, ${results.failed} falhados.`,
      summary: {
        totalOrders: results.totalOrders,
        imported: results.imported,
        skipped: results.skipped,
        failed: results.failed,
        processedBatches: results.processedBatches
      },
      batches: results.batches
    });
  } catch (error) {
    console.error("[cakto:batch-import] Falha na importacao em lotes.", {
      message: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      error: "Falha ao importar pedidos em lotes.",
      message: error.message
    });
  }
});

module.exports = router;
