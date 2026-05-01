const fs = require("fs");
const express = require("express");
const prisma = require("../lib/prisma");
const { requireActiveAccess, requireAuth } = require("../middlewares/auth");
const {
  resolveStoragePath,
  safeContentDisposition,
  stickerDownloadUrl,
  stickerImageUrl
} = require("../lib/sticker-storage");

const router = express.Router();

router.use(requireAuth, requireActiveAccess);

function categoryCard(category) {
  const coverImage = category.cover?.image || category.images?.[0] || null;

  return {
    id: category.id,
    slug: category.slug,
    title: category.title,
    description: category.description,
    totalStickers: category._count?.images || 0,
    coverImageId: coverImage?.id || null,
    coverUrl: coverImage ? stickerImageUrl(coverImage.id) : null,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt
  };
}

function imageResponse(image) {
  return {
    id: image.id,
    name: image.originalName,
    originalName: image.originalName,
    mimeType: image.mimeType,
    size: image.size,
    url: stickerImageUrl(image.id),
    downloadUrl: stickerDownloadUrl(image.id),
    createdAt: image.createdAt
  };
}

router.get("/categories", async (_req, res) => {
  const categories = await prisma.stickerCategory.findMany({
    orderBy: { title: "asc" },
    include: {
      cover: {
        include: { image: true }
      },
      images: {
        orderBy: { createdAt: "asc" },
        take: 1
      },
      _count: { select: { images: true } }
    }
  });

  return res.json({ categories: categories.map(categoryCard) });
});

router.get("/categories/:id/images", async (req, res) => {
  const category = await prisma.stickerCategory.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      images: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!category) {
    return res.status(404).json({ error: "Categoria nao encontrada." });
  }

  return res.json({
    category: {
      id: category.id,
      slug: category.slug,
      title: category.title,
      description: category.description
    },
    images: category.images.map(imageResponse)
  });
});

async function sendImage(req, res, disposition) {
  const image = await prisma.stickerImage.findUnique({
    where: { id: req.params.id }
  });

  if (!image) {
    return res.status(404).json({ error: "Imagem nao encontrada." });
  }

  const filePath = resolveStoragePath(image.storageKey);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Arquivo da imagem nao encontrado." });
  }

  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", safeContentDisposition(disposition, image.originalName));

  return fs.createReadStream(filePath).pipe(res);
}

router.get("/images/:id/download", async (req, res) => {
  return sendImage(req, res, "attachment");
});

router.get("/images/:id", async (req, res) => {
  return sendImage(req, res, "inline");
});

module.exports = router;
