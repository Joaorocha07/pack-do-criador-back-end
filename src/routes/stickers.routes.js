const express = require("express");
const prisma = require("../lib/prisma");
const { requireActiveAccess, requireAuth } = require("../middlewares/auth");
const {
  getStickerFile,
  publicStickerFileUrl,
  safeContentDisposition,
  shouldRedirectStickerDelivery,
  stickerDownloadUrl,
  stickerImageUrl
} = require("../lib/sticker-storage");

const router = express.Router();

router.use(requireAuth, requireActiveAccess);

const DEFAULT_IMAGES_LIMIT = 60;
const MAX_IMAGES_LIMIT = 200;

function parseImagesLimit(value) {
  const limit = Number.parseInt(value, 10);

  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_IMAGES_LIMIT;
  }

  return Math.min(limit, MAX_IMAGES_LIMIT);
}

function parsePositiveInteger(value, defaultValue) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number) || number < 1) {
    return defaultValue;
  }

  return number;
}

function parseOffset(value, page, limit) {
  if (value !== undefined) {
    const offset = Number.parseInt(value, 10);

    if (Number.isFinite(offset) && offset >= 0) {
      return offset;
    }
  }

  return (page - 1) * limit;
}

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
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1
      },
      _count: { select: { images: true } }
    }
  });

  return res.json({ categories: categories.map(categoryCard) });
});

router.get("/categories/:id/images", async (req, res) => {
  const limit = parseImagesLimit(req.query.limit);
  const page = parsePositiveInteger(req.query.page, 1);
  const offset = parseOffset(req.query.offset, page, limit);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
  const paginationQuery = cursor
    ? {
        cursor: { id: cursor },
        skip: 1
      }
    : {
        skip: offset
      };

  const category = await prisma.stickerCategory.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      images: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...paginationQuery
      }
    }
  });

  if (!category) {
    return res.status(404).json({ error: "Categoria nao encontrada." });
  }

  const hasNextPage = category.images.length > limit;
  const images = hasNextPage ? category.images.slice(0, limit) : category.images;
  const nextCursor = hasNextPage ? images[images.length - 1]?.id || null : null;

  return res.json({
    category: {
      id: category.id,
      slug: category.slug,
      title: category.title,
      description: category.description
    },
    images: images.map(imageResponse),
    pagination: {
      limit,
      page: cursor ? null : page,
      offset: cursor ? null : offset,
      hasNextPage,
      nextCursor,
      nextPage: !cursor && hasNextPage ? page + 1 : null,
      nextOffset: !cursor && hasNextPage ? offset + images.length : null
    }
  });
});

async function sendImage(req, res, disposition) {
  const image = await prisma.stickerImage.findUnique({
    where: { id: req.params.id }
  });

  if (!image) {
    return res.status(404).json({ error: "Imagem nao encontrada." });
  }

  if (shouldRedirectStickerDelivery()) {
    const publicUrl = publicStickerFileUrl(image.storageKey);

    if (publicUrl) {
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.redirect(302, publicUrl);
    }
  }

  const storedFile = await getStickerFile(image.storageKey);

  if (!storedFile) {
    return res.status(404).json({ error: "Arquivo da imagem nao encontrado." });
  }

  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", safeContentDisposition(disposition, image.originalName));

  if (storedFile.contentLength) {
    res.setHeader("Content-Length", String(storedFile.contentLength));
  }

  return storedFile.stream.pipe(res);
}

router.get("/images/:id/download", async (req, res) => {
  return sendImage(req, res, "attachment");
});

router.get("/images/:id", async (req, res) => {
  return sendImage(req, res, "inline");
});

module.exports = router;
