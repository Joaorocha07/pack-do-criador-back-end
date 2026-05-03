const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { comparePassword, hashPassword } = require("../lib/password");
const { signAccessToken } = require("../lib/jwt");
const { sendDeviceBlockedAlert } = require("../lib/device-block-alert");
const { sendPasswordResetCodeEmail } = require("../lib/mailer");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  deviceId: z.string().trim().min(8).max(255).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8)
});

const passwordResetRequestSchema = z.object({
  email: z.string().email()
});

const passwordResetConfirmSchema = z.object({
  email: z.string().email(),
  code: z.string().trim().regex(/^\d{6}$/),
  newPassword: z.string().min(8)
});

const PASSWORD_RESET_CODE_TTL_MINUTES = Number(
  process.env.PASSWORD_RESET_CODE_TTL_MINUTES || 15
);
const PASSWORD_RESET_RESEND_SECONDS = Number(
  process.env.PASSWORD_RESET_RESEND_SECONDS || 60
);
const PASSWORD_RESET_MAX_ATTEMPTS = Number(
  process.env.PASSWORD_RESET_MAX_ATTEMPTS || 5
);

function roleForApi(role) {
  return String(role || "USER").toLowerCase();
}

function getRequestDeviceId(req, bodyDeviceId) {
  const headerDeviceId = req.headers["x-device-id"];
  const deviceId = bodyDeviceId || headerDeviceId;

  return typeof deviceId === "string" ? deviceId.trim() : null;
}

function shouldEnforceDevice(profile) {
  return roleForApi(profile?.role) === "user";
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
      disabledReason: status.disabledReason,
      deviceId: profile.deviceId || null,
      deviceBoundAt: profile.deviceBoundAt || null,
      deviceBlockedEmailSentAt: profile.deviceBlockedEmailSentAt || null,
      deviceBound: Boolean(profile.deviceId),
      requiresDeviceId: shouldEnforceDevice(profile)
    }
  };
}

function passwordResetGenericResponse() {
  return {
    ok: true,
    message: "Se o email estiver cadastrado, enviaremos um codigo para redefinir a senha."
  };
}

function generatePasswordResetCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashPasswordResetCode(email, code) {
  const secret = process.env.JWT_SECRET || "password-reset";

  return crypto
    .createHash("sha256")
    .update(`${email.toLowerCase()}:${code}:${secret}`)
    .digest("hex");
}

function resetCodeExpiresAt() {
  return new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MINUTES * 60 * 1000);
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

  let profile = user.profile;
  const status = profileStatus(profile);

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

  if (shouldEnforceDevice(profile)) {
    const deviceId = getRequestDeviceId(req, parsed.data.deviceId);

    if (!deviceId) {
      return res.status(400).json({
        error: "ID do aparelho nao informado.",
        message: "Envie deviceId no body ou no header x-device-id."
      });
    }

    if (!profile.deviceId) {
      profile = await prisma.userProfile.update({
        where: { userId: user.id },
        data: {
          deviceId,
          deviceBoundAt: new Date()
        }
      });
      user.profile = profile;
    } else if (profile.deviceId !== deviceId) {
      sendDeviceBlockedAlert(user);

      return res.status(403).json({
        error: "Acesso bloqueado neste aparelho.",
        message: "Este perfil ja esta vinculado a outro aparelho. Fale com o suporte para resetar o acesso."
      });
    }
  }

  return res.json({
    token: signAccessToken({ ...user, role: user.profile?.role || user.role }),
    user: authUserResponse(user)
  });
});

router.post("/password-reset/request", async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Informe um email valido." });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      hasAccess: true,
      passwordResetCodes: {
        where: { usedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!user || !user.hasAccess) {
    return res.json(passwordResetGenericResponse());
  }

  const latestCode = user.passwordResetCodes[0];
  const secondsSinceLatest = latestCode
    ? (Date.now() - new Date(latestCode.createdAt).getTime()) / 1000
    : null;

  if (secondsSinceLatest !== null && secondsSinceLatest < PASSWORD_RESET_RESEND_SECONDS) {
    return res.json(passwordResetGenericResponse());
  }

  const code = generatePasswordResetCode();

  await prisma.passwordResetCode.create({
    data: {
      userId: user.id,
      codeHash: hashPasswordResetCode(user.email, code),
      expiresAt: resetCodeExpiresAt()
    }
  });

  await sendPasswordResetCodeEmail({
    to: user.email,
    name: user.name,
    code
  });

  return res.json(passwordResetGenericResponse());
});

router.post("/password-reset/confirm", async (req, res) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Informe email, codigo de 6 digitos e nova senha com pelo menos 8 caracteres."
    });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      hasAccess: true,
      passwordResetCodes: {
        where: {
          usedAt: null,
          expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!user || !user.hasAccess || !user.passwordResetCodes[0]) {
    return res.status(400).json({ error: "Codigo invalido ou expirado." });
  }

  const resetCode = user.passwordResetCodes[0];

  if (resetCode.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
    await prisma.passwordResetCode.update({
      where: { id: resetCode.id },
      data: { usedAt: new Date() }
    });

    return res.status(400).json({ error: "Codigo invalido ou expirado." });
  }

  const codeHash = hashPasswordResetCode(user.email, parsed.data.code);

  if (codeHash !== resetCode.codeHash) {
    await prisma.passwordResetCode.update({
      where: { id: resetCode.id },
      data: { attempts: { increment: 1 } }
    });

    return res.status(400).json({ error: "Codigo invalido ou expirado." });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(parsed.data.newPassword),
        temporaryPassword: false
      }
    }),
    prisma.passwordResetCode.updateMany({
      where: {
        userId: user.id,
        usedAt: null
      },
      data: {
        usedAt: new Date()
      }
    })
  ]);

  return res.json({
    ok: true,
    message: "Senha alterada com sucesso. Voce ja pode fazer login."
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
