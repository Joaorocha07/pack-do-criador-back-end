const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

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

function requireAdmin(req, res, next) {
  if (!["ADMIN", "SUPER_ADMIN"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Acesso restrito ao administrador." });
  }

  return next();
}

async function requireActiveAccess(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.sub },
      select: { id: true, role: true, hasAccess: true }
    });

    if (!user || !user.hasAccess) {
      return res.status(403).json({ error: "Acesso nao liberado." });
    }

    req.accessUser = user;
    return next();
  } catch (error) {
    console.error("[auth] Falha ao verificar acesso do usuario.", error);
    return res.status(500).json({ error: "Falha ao verificar acesso." });
  }
}

module.exports = { requireActiveAccess, requireAdmin, requireAuth };
