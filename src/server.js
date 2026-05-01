require("dotenv").config();
require("./lib/express-async-errors");

const express = require("express");
const cors = require("cors");
const prisma = require("./lib/prisma");
const { connectPrisma } = require("./lib/prisma");
const { logError, serializeError } = require("./lib/error-logging");
const adminStickerRoutes = require("./routes/admin-stickers.routes");
const adminRoutes = require("./routes/admin.routes");
const authRoutes = require("./routes/auth.routes");
const caktoRoutes = require("./routes/cakto.routes");
const stickerRoutes = require("./routes/stickers.routes");
const { requireAdmin, requireAuth } = require("./middlewares/auth");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/health/db", async (_req, res) => {
  try {
    const [result] = await prisma.$queryRaw`
      SELECT
        to_regclass('public."User"')::text as "userTable",
        to_regclass('public."Purchase"')::text as "purchaseTable",
        to_regclass('public."StickerCategory"')::text as "stickerCategoryTable",
        to_regclass('public."StickerImage"')::text as "stickerImageTable",
        to_regclass('public."StickerCategoryCover"')::text as "stickerCategoryCoverTable"
    `;

    res.json({
      ok: true,
      databaseConnected: true,
      schemaReady: Boolean(
        result.userTable &&
          result.purchaseTable &&
          result.stickerCategoryTable &&
          result.stickerImageTable &&
          result.stickerCategoryCoverTable
      ),
      tables: {
        User: Boolean(result.userTable),
        Purchase: Boolean(result.purchaseTable),
        StickerCategory: Boolean(result.stickerCategoryTable),
        StickerImage: Boolean(result.stickerImageTable),
        StickerCategoryCover: Boolean(result.stickerCategoryCoverTable)
      }
    });
  } catch (error) {
    logError("[health:db] Falha ao verificar banco.", error);
    res.status(500).json({
      ok: false,
      databaseConnected: false,
      message: error.message
    });
  }
});

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/admin/stickers", requireAuth, requireAdmin, adminStickerRoutes);
app.use("/stickers", stickerRoutes);
app.use("/webhooks/cakto", caktoRoutes);

app.use((error, req, res, next) => {
  logError("[http] Erro nao tratado na rota.", error, {
    method: req.method,
    path: req.originalUrl
  });

  if (res.headersSent) {
    return next(error);
  }

  const status = error.status || error.statusCode || 500;

  return res.status(status).json({
    error: status >= 500 ? "Erro interno do servidor." : error.message,
    message: process.env.NODE_ENV === "production" ? undefined : error.message
  });
});

const port = process.env.PORT || 3333;

async function ensureUserProfiles() {
  const usersWithoutProfile = await prisma.user.findMany({
    where: { profile: { is: null } },
    select: { id: true, role: true }
  });

  for (const user of usersWithoutProfile) {
    await prisma.userProfile.create({
      data: {
        userId: user.id,
        role: user.role || "USER"
      }
    });
  }

  if (usersWithoutProfile.length) {
    console.log("[profiles] Perfis criados para usuarios existentes.", {
      total: usersWithoutProfile.length
    });
  }
}

async function startServer() {
  try {
    await connectPrisma();
    await ensureUserProfiles();

    const server = app.listen(port, () => {
      console.log(`API rodando na porta ${port}`);
    });

    async function shutdown(signal) {
      console.log(`[server] Encerrando por ${signal}.`);
      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logError("[server] Nao foi possivel iniciar a API.", error);
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[process] Promise rejeitada sem tratamento.", serializeError(reason));
});

process.on("uncaughtException", (error) => {
  logError("[process] Excecao nao capturada.", error);
  process.exit(1);
});

startServer();
