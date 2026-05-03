const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { listCaktoOrders } = require("../lib/cakto-api");
const { generateTemporaryPassword, hashPassword } = require("../lib/password");
const { sendAccessEmail } = require("../lib/mailer");
const { requireAdmin, requireAuth } = require("../middlewares/auth");

const router = express.Router();
const PROFILE_ROLES = ["ADMIN", "USER", "TESTE", "AFILIADO"];

const roleSchema = z.object({
  role: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => PROFILE_ROLES.includes(value), {
      message: "Tipo de perfil invalido."
    })
});

const temporaryDisableSchema = z.object({
  disabledUntil: z.coerce.date(),
  reason: z.string().trim().max(500).optional().nullable()
});

const passwordUpdateSchema = z.object({
  password: z.string().min(8),
  temporaryPassword: z.boolean().optional()
});

const affiliateImportSchema = z.object({
  affiliates: z.array(
    z.object({
      name: z.string().trim().optional().nullable(),
      email: z.string().trim().email(),
      productName: z.string().trim().optional().nullable(),
      commissionPercentage: z.union([z.string(), z.number()]).optional().nullable(),
      status: z.string().trim().optional().nullable()
    })
  )
});

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function roleForApi(role) {
  return String(role || "USER").toLowerCase();
}

function profileStatus(profile) {
  const disabledUntil = profile?.disabledUntil || null;
  const temporarilyDisabled = Boolean(
    profile?.temporarilyDisabled &&
      (!disabledUntil || new Date(disabledUntil).getTime() > Date.now())
  );

  return {
    temporarilyDisabled,
    disabledUntil,
    disabledReason: profile?.disabledReason || null
  };
}

async function ensureUserProfile(user) {
  if (user.profile) {
    return user.profile;
  }

  return prisma.userProfile.create({
    data: {
      userId: user.id,
      role: user.role || "USER"
    }
  });
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
  const profile = user.profile || {
    role: user.role,
    temporarilyDisabled: false,
    disabledUntil: null,
    disabledReason: null
  };
  const status = profileStatus(profile);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: profile.role,
    roleLabel: roleForApi(profile.role),
    hasAccess: user.hasAccess,
    temporaryPassword: user.temporaryPassword,
    accessEmailSent: user.accessEmailSent,
    accessEmailSentAt: user.accessEmailSentAt,
    profile: {
      id: profile.id || null,
      role: profile.role,
      roleLabel: roleForApi(profile.role),
      temporarilyDisabled: status.temporarilyDisabled,
      disabledUntil: status.disabledUntil,
      disabledReason: status.disabledReason
    }
  };
}

function isPaidPackOrder(order) {
  const expectedProduct = normalize(process.env.CAKTO_PRODUCT_NAME || "Pack do Criador");
  const productName = normalize(order.product?.name);
  const status = normalize(order.status);

  return productName === expectedProduct && status === "paid";
}

function getCommissionForUser(order, commissionedUser) {
  const commissionedUserId = String(commissionedUser?.id || "");

  return (order.commissions || []).find((commission) => {
    const commissionUserId = String(commission.userId || commission.user_id || "");
    return commissionUserId === commissionedUserId && normalize(commission.type) === "affiliate";
  });
}

function affiliateResponse({ commissionedUser, commission, order }) {
  const email = commissionedUser?.email?.toLowerCase() || null;
  const fallbackId = email || commissionedUser?.id;

  return {
    id: `cakto-affiliate-${fallbackId}`,
    name: commissionedUser?.name || commissionedUser?.fullName || "-",
    email,
    role: "AFILIADO",
    roleLabel: "afiliado",
    hasAccess: false,
    temporaryPassword: false,
    accessEmailSent: false,
    accessEmailSentAt: null,
    source: "cakto",
    affiliate: {
      id: commissionedUser?.id || null,
      productName: order.product?.name || null,
      commissionPercentage: commission?.commissionPercentage ?? null,
      commissionValue: commission?.commissionValue ?? null,
      lastOrderId: order.id || null,
      lastOrderDate: order.paidAt || order.createdAt || null
    },
    profile: {
      id: null,
      role: "AFILIADO",
      roleLabel: "afiliado",
      temporarilyDisabled: false,
      disabledUntil: null,
      disabledReason: null
    }
  };
}

async function listCaktoAffiliateUsers({ maxPages = 20 } = {}) {
  const orders = await listCaktoOrders({ maxPages });
  const affiliatesByKey = new Map();

  for (const order of orders.filter(isPaidPackOrder)) {
    for (const commissionedUser of order.commissionedUsers || []) {
      const commission = getCommissionForUser(order, commissionedUser);

      if (!commission) {
        continue;
      }

      const key = normalize(commissionedUser.email) || String(commissionedUser.id || "");

      if (!key || affiliatesByKey.has(key)) {
        continue;
      }

      affiliatesByKey.set(
        key,
        affiliateResponse({
          commissionedUser,
          commission,
          order
        })
      );
    }
  }

  return Array.from(affiliatesByKey.values());
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

async function importAffiliate(affiliate) {
  const email = normalize(affiliate.email);
  const name = affiliate.name && affiliate.name !== "-" ? affiliate.name : null;
  const existingUser = await prisma.user.findUnique({
    where: { email },
    include: { profile: true }
  });

  if (existingUser) {
    const role = existingUser.role === "ADMIN" ? existingUser.role : "AFILIADO";
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: name || existingUser.name,
        role
      },
      include: { profile: true }
    });
    const profile = await prisma.userProfile.upsert({
      where: { userId: existingUser.id },
      create: {
        userId: existingUser.id,
        role
      },
      update: {
        role
      }
    });

    return {
      imported: false,
      updated: true,
      email,
      user: userResponse({ ...updatedUser, profile })
    };
  }

  const password = generateTemporaryPassword();
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: "AFILIADO",
      passwordHash: await hashPassword(password),
      hasAccess: false,
      temporaryPassword: false
    }
  });
  const profile = await ensureUserProfile(user);

  return {
    imported: true,
    updated: false,
    email,
    user: userResponse({ ...user, profile })
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
  const profile = await prisma.userProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      role: "ADMIN"
    },
    update: {
      role: "ADMIN",
      temporarilyDisabled: false,
      disabledUntil: null,
      disabledReason: null
    }
  });
  const userWithProfile = { ...user, profile };

  return res.json({
    ok: true,
    user: userResponse(userWithProfile)
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

router.post("/import-affiliates", async (req, res) => {
  const parsed = affiliateImportSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Informe affiliates com nome e email dos afiliados."
    });
  }

  const results = [];

  for (const affiliate of parsed.data.affiliates) {
    results.push(await importAffiliate(affiliate));
  }

  return res.json({
    ok: true,
    summary: {
      received: parsed.data.affiliates.length,
      imported: results.filter((result) => result.imported).length,
      updated: results.filter((result) => result.updated).length
    },
    users: results.map((result) => result.user)
  });
});

router.get("/users", async (req, res) => {
  const requestedAffiliatePages = Number(req.query.affiliatePages || 20);
  const maxAffiliatePages = Number.isFinite(requestedAffiliatePages)
    ? Math.max(1, requestedAffiliatePages)
    : 20;
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
      accessEmailSentAt: true,
      profile: true
    }
  });
  const localUsers = users.map(userResponse);
  let caktoAffiliates = [];
  let caktoAffiliateError = null;

  try {
    caktoAffiliates = await listCaktoAffiliateUsers({ maxPages: maxAffiliatePages });
  } catch (error) {
    caktoAffiliateError = error.message;
    console.error("[admin:users] Falha ao listar afiliados da Cakto.", {
      message: error.message
    });
  }

  const localEmails = new Set(localUsers.map((user) => normalize(user.email)).filter(Boolean));
  const externalAffiliates = caktoAffiliates.filter((affiliate) => {
    const email = normalize(affiliate.email);
    return !email || !localEmails.has(email);
  });

  return res.json({
    ok: true,
    users: [...localUsers, ...externalAffiliates],
    sources: {
      database: localUsers.length,
      caktoAffiliates: externalAffiliates.length
    },
    warnings: caktoAffiliateError
      ? [{ source: "cakto", message: "Afiliados da Cakto nao foram carregados.", detail: caktoAffiliateError }]
      : []
  });
});

router.patch("/users/:id/role", async (req, res) => {
  const parsed = roleSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Tipo de perfil invalido.",
      allowedRoles: PROFILE_ROLES.map(roleForApi)
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { profile: true }
  });

  if (!user) {
    return res.status(404).json({ error: "Usuario nao encontrado." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role: parsed.data.role }
  });

  const profile = await prisma.userProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      role: parsed.data.role
    },
    update: {
      role: parsed.data.role
    }
  });

  return res.json({
    ok: true,
    message: "Tipo de perfil atualizado.",
    user: userResponse({ ...user, role: parsed.data.role, profile })
  });
});

router.patch("/users/:id/temporary-disable", async (req, res) => {
  const parsed = temporaryDisableSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Informe disabledUntil com uma data valida."
    });
  }

  if (parsed.data.disabledUntil.getTime() <= Date.now()) {
    return res.status(400).json({
      error: "disabledUntil precisa ser uma data futura."
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { profile: true }
  });

  if (!user) {
    return res.status(404).json({ error: "Usuario nao encontrado." });
  }

  const profile = await prisma.userProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      role: user.role || "USER",
      temporarilyDisabled: true,
      disabledUntil: parsed.data.disabledUntil,
      disabledReason: parsed.data.reason || null
    },
    update: {
      temporarilyDisabled: true,
      disabledUntil: parsed.data.disabledUntil,
      disabledReason: parsed.data.reason || null
    }
  });

  return res.json({
    ok: true,
    message: "Conta desativada temporariamente.",
    user: userResponse({ ...user, profile })
  });
});

router.delete("/users/:id/temporary-disable", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { profile: true }
  });

  if (!user) {
    return res.status(404).json({ error: "Usuario nao encontrado." });
  }

  const profile = await prisma.userProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      role: user.role || "USER",
      temporarilyDisabled: false
    },
    update: {
      temporarilyDisabled: false,
      disabledUntil: null,
      disabledReason: null
    }
  });

  return res.json({
    ok: true,
    message: "Conta reativada.",
    user: userResponse({ ...user, profile })
  });
});

router.patch("/users/:id/password", async (req, res) => {
  const parsed = passwordUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Informe password com no minimo 8 caracteres."
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { profile: true }
  });

  if (!user) {
    return res.status(404).json({ error: "Usuario nao encontrado." });
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.password),
      temporaryPassword: parsed.data.temporaryPassword ?? false
    },
    include: { profile: true }
  });

  return res.json({
    ok: true,
    message: "Senha do perfil atualizada.",
    user: userResponse(updatedUser)
  });
});

router.post("/send-access-email", async (req, res) => {
  const email = req.body?.email?.toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "Informe o email do usuario." });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { profile: true }
  });

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
    },
    include: { profile: true }
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
      },
      include: { profile: true }
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
