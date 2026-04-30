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

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Email ou senha invalidos." });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.hasAccess) {
    return res.status(401).json({ error: "Acesso nao encontrado." });
  }

  const passwordMatches = await comparePassword(parsed.data.password, user.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({ error: "Email ou senha invalidos." });
  }

  return res.json({
    token: signAccessToken(user),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      hasAccess: user.hasAccess,
      temporaryPassword: user.temporaryPassword
    }
  });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos." });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });

  if (!user) {
    return res.status(404).json({ error: "Usuario nao encontrado." });
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

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      hasAccess: true,
      temporaryPassword: true
    }
  });

  if (!user || !user.hasAccess) {
    return res.status(401).json({ error: "Acesso nao encontrado." });
  }

  return res.json({ user });
});

module.exports = router;
