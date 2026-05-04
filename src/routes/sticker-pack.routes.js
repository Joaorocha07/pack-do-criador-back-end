const express = require("express");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

const DEFAULT_DOWNLOAD_LINK_TTL_SECONDS = 15 * 60;

function getApiBaseUrl(req) {
  const configuredUrl = process.env.BACKEND_PUBLIC_URL || process.env.API_PUBLIC_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

function packResponse(req, pack) {
  const expiresAt = Math.floor(Date.now() / 1000) + getDownloadLinkTtlSeconds();
  const signature = signDownloadUrl(pack.id, expiresAt);

  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    coverUrl: pack.coverUrl,
    downloadUrl: `${getApiBaseUrl(req)}/sticker-packs/${pack.id}/download?expires=${expiresAt}&signature=${signature}`,
    category: pack.category
  };
}

function getDownloadLinkTtlSeconds() {
  const configuredTtl = Number(process.env.DOWNLOAD_LINK_TTL_SECONDS);

  if (Number.isInteger(configuredTtl) && configuredTtl > 0) {
    return configuredTtl;
  }

  return DEFAULT_DOWNLOAD_LINK_TTL_SECONDS;
}

function getDownloadSecret() {
  return process.env.DOWNLOAD_LINK_SECRET || process.env.JWT_SECRET;
}

function signDownloadUrl(packId, expiresAt) {
  return crypto
    .createHmac("sha256", getDownloadSecret())
    .update(`${packId}.${expiresAt}`)
    .digest("hex");
}

function isValidDownloadSignature(packId, expiresAt, signature) {
  if (!expiresAt || !signature || Number(expiresAt) < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expectedSignature = signDownloadUrl(packId, expiresAt);
  const expected = Buffer.from(expectedSignature, "hex");
  const received = Buffer.from(String(signature), "hex");

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

router.get("/", requireAuth, async (req, res) => {
  const packs = await prisma.stickerPack.findMany({
    where: { isActive: true },
    orderBy: [
      { sortOrder: "asc" },
      { name: "asc" }
    ],
    select: {
      id: true,
      name: true,
      description: true,
      coverUrl: true,
      downloadUrl: true,
      category: true
    }
  });

  return res.json({ packs: packs.map((pack) => packResponse(req, pack)) });
});

router.get("/:id/download", async (req, res) => {
  if (!isValidDownloadSignature(req.params.id, req.query.expires, req.query.signature)) {
    return res.status(401).json({ error: "Link de download invalido ou expirado." });
  }

  const pack = await prisma.stickerPack.findFirst({
    where: {
      id: req.params.id,
      isActive: true
    },
    select: {
      downloadUrl: true
    }
  });

  if (!pack) {
    return res.status(404).json({ error: "Pack nao encontrado." });
  }

  res.set("Cache-Control", "private, no-store");
  return res.redirect(302, pack.downloadUrl);
});

module.exports = router;
