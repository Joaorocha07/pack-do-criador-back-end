const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

function activeProfileStatus(profile) {
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

function roleForApi(role) {
  return String(role || "USER").toLowerCase();
}

function getRequestDeviceId(req) {
  const deviceId = req.headers["x-device-id"];

  return typeof deviceId === "string" ? deviceId.trim() : null;
}

function shouldEnforceDevice(profile) {
  return roleForApi(profile?.role) === "user";
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Token nao informado." });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Token invalido." });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.sub },
      select: {
        id: true,
        role: true,
        hasAccess: true,
        profile: true
      }
    });

    const role = user?.profile?.role || user?.role || req.user?.role;
    const status = activeProfileStatus(user?.profile);

    if (!user || !user.hasAccess || status.temporarilyDisabled) {
      return res.status(403).json({
        error: status.temporarilyDisabled
          ? "Conta temporariamente desativada."
          : "Acesso restrito ao administrador.",
        disabledUntil: status.disabledUntil,
        disabledReason: status.disabledReason
      });
    }

    if (!["ADMIN", "SUPER_ADMIN"].includes(role)) {
      return res.status(403).json({ error: "Acesso restrito ao administrador." });
    }

    req.adminUser = user;
    return next();
  } catch (error) {
    console.error("[auth] Falha ao verificar permissao de administrador.", error);
    return res.status(500).json({ error: "Falha ao verificar permissao." });
  }
}

function requireAdminFromToken(req, res, next) {
  if (!["ADMIN", "SUPER_ADMIN"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Acesso restrito ao administrador." });
  }

  return next();
}

async function requireActiveAccess(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.sub },
      select: {
        id: true,
        role: true,
        hasAccess: true,
        profile: true
      }
    });

    if (!user || !user.hasAccess) {
      return res.status(403).json({ error: "Acesso nao liberado." });
    }

    const status = activeProfileStatus(user.profile);

    if (status.temporarilyDisabled) {
      return res.status(403).json({
        error: "Conta temporariamente desativada.",
        disabledUntil: status.disabledUntil,
        disabledReason: status.disabledReason
      });
    }

    if (shouldEnforceDevice(user.profile)) {
      const deviceId = getRequestDeviceId(req);

      if (!deviceId) {
        return res.status(400).json({
          error: "ID do aparelho nao informado.",
          message: "Envie o header x-device-id em chamadas protegidas."
        });
      }

      if (!user.profile?.deviceId) {
        const profile = await prisma.userProfile.update({
          where: { userId: user.id },
          data: {
            deviceId,
            deviceBoundAt: new Date()
          }
        });
        user.profile = profile;
      } else if (user.profile.deviceId !== deviceId) {
        return res.status(403).json({
          error: "Acesso bloqueado neste aparelho.",
          message: "Este perfil ja esta vinculado a outro aparelho. Fale com o suporte para resetar o acesso."
        });
      }
    }

    req.accessUser = user;
    return next();
  } catch (error) {
    console.error("[auth] Falha ao verificar acesso do usuario.", error);
    return res.status(500).json({ error: "Falha ao verificar acesso." });
  }
}

module.exports = { requireActiveAccess, requireAdmin, requireAdminFromToken, requireAuth };
