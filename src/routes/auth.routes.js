const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { comparePassword, hashPassword } = require("../lib/password");
const { signAccessToken } = require("../lib/jwt");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8)
});

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

function authUserResponse(user) {
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
    profile: {
      role: profile.role,
      roleLabel: roleForApi(profile.role),
      temporarilyDisabled: status.temporarilyDisabled,
      disabledUntil: status.disabledUntil,
      disabledReason: status.disabledReason
    }
  };
}

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Email ou senha invalidos." });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: { profile: true }
  });

  if (!user || !user.hasAccess) {
    return res.status(401).json({ error: "Acesso nao encontrado." });
  }

  const status = profileStatus(user.profile);

  if (status.temporarilyDisabled) {
    return res.status(403).json({
      error: "Conta temporariamente desativada.",
      disabledUntil: status.disabledUntil,
      disabledReason: status.disabledReason
    });
  }

  const passwordMatches = await comparePassword(parsed.data.password, user.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({ error: "Email ou senha invalidos." });
  }

  return res.json({
    token: signAccessToken({ ...user, role: user.profile?.role || user.role }),
    user: authUserResponse(user)
  });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos." });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    include: { profile: true }
  });

  if (!user) {
    return res.status(404).json({ error: "Usuario nao encontrado." });
  }

  const status = profileStatus(user.profile);

  if (status.temporarilyDisabled) {
    return res.status(403).json({
      error: "Conta temporariamente desativada.",
      disabledUntil: status.disabledUntil,
      disabledReason: status.disabledReason
    });
  }

  const passwordMatches = await comparePassword(
    parsed.data.currentPassword,
    user.passwordHash
  );

  if (!passwordMatches) {
    return res.status(401).json({ error: "Senha atual incorreta." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      temporaryPassword: false
    }
  });

  return res.json({ ok: true });
});

router.post("/logout", requireAuth, (_req, res) => {
  return res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      hasAccess: true,
      temporaryPassword: true,
      profile: true
    }
  });

  if (!user || !user.hasAccess) {
    return res.status(401).json({ error: "Acesso nao encontrado." });
  }

  const status = profileStatus(user.profile);

  if (status.temporarilyDisabled) {
    return res.status(403).json({
      error: "Conta temporariamente desativada.",
      disabledUntil: status.disabledUntil,
      disabledReason: status.disabledReason
    });
  }

  return res.json({ user: authUserResponse(user) });
});

module.exports = router;
