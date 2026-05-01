require("dotenv").config();

const express = require("express");
const cors = require("cors");
const prisma = require("./lib/prisma");
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
    console.error("[health:db] Falha ao verificar banco.", error);
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

const port = process.env.PORT || 3333;

app.listen(port, () => {
  console.log(`API rodando na porta ${port}`);
});
