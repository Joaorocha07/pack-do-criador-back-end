const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { parseMultipartFiles } = require("../lib/multipart-files");
const {
  assertAllowedImage,
  deleteStickerFile,
  getStorageUsageFromProvider,
  saveStickerFile,
  storageProviderName,
  stickerDownloadUrl,
  stickerImageUrl
} = require("../lib/sticker-storage");

const router = express.Router();

const categorySchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().max(2000).optional().nullable()
});

const categoryPatchSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  coverImageId: z.string().uuid().optional().nullable()
});

const isVercelRuntime = Boolean(process.env.VERCEL);
const vercelRequestLimitMb = 4;

const configuredMaxImageMb = Number(process.env.STICKER_UPLOAD_MAX_IMAGE_MB || 20);
const configuredMaxRequestMb = Number(process.env.STICKER_UPLOAD_MAX_REQUEST_MB || 512);
const effectiveMaxImageMb = isVercelRuntime
  ? Math.min(configuredMaxImageMb, vercelRequestLimitMb)
  : configuredMaxImageMb;
const effectiveMaxRequestMb = isVercelRuntime
  ? Math.min(configuredMaxRequestMb, vercelRequestLimitMb)
  : configuredMaxRequestMb;

const MAX_IMAGE_BYTES = effectiveMaxImageMb * 1024 * 1024;
const MAX_FILES = Number(process.env.STICKER_UPLOAD_MAX_FILES || 1000);
const MAX_TOTAL_BYTES = effectiveMaxRequestMb * 1024 * 1024;
const STORAGE_LIMIT_MB = Number(process.env.STICKER_STORAGE_MAX_MB || 0);
const STORAGE_LIMIT_BYTES = STORAGE_LIMIT_MB > 0 ? STORAGE_LIMIT_MB * 1024 * 1024 : 0;

function slugify(title) {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "categoria";
}

async function uniqueSlug(title, ignoredCategoryId) {
  const baseSlug = slugify(title);
  let slug = baseSlug;
  let suffix = 2;

  while (true) {
    const existing = await prisma.stickerCategory.findUnique({ where: { slug } });

    if (!existing || existing.id === ignoredCategoryId) {
      return slug;
    }

    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

function categoryResponse(category) {
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
    categoryId: image.categoryId,
    originalName: image.originalName,
    name: image.originalName,
    mimeType: image.mimeType,
    size: image.size,
    url: stickerImageUrl(image.id),
    downloadUrl: stickerDownloadUrl(image.id),
    createdAt: image.createdAt
  };
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function getStorageUsageFromDatabase() {
  const result = await prisma.stickerImage.aggregate({
    _sum: {
      size: true
    }
  });

  return result._sum.size || 0;
}

async function getStorageUsage(uploadBytes = 0) {
  const databaseBytes = await getStorageUsageFromDatabase();
  const providerUsage = await getStorageUsageFromProvider();
  const currentBytes =
    typeof providerUsage.totalBytes === "number" ? providerUsage.totalBytes : databaseBytes;
  const nextBytes = currentBytes + uploadBytes;
  const percentUsed = STORAGE_LIMIT_BYTES
    ? Number(((currentBytes / STORAGE_LIMIT_BYTES) * 100).toFixed(2))
    : null;

  return {
    label: "Uso do Cloudflare R2",
    description: STORAGE_LIMIT_BYTES
      ? `Usado ${formatMb(currentBytes)} de ${formatMb(STORAGE_LIMIT_BYTES)}.`
      : `Usado ${formatMb(currentBytes)}. Nenhuma trava de storage configurada.`,
    currentBytes,
    currentMb: Number((currentBytes / 1024 / 1024).toFixed(2)),
    currentFormatted: formatMb(currentBytes),
    source: providerUsage.source,
    provider: storageProviderName(),
    databaseBytes,
    databaseFormatted: formatMb(databaseBytes),
    objectCount: providerUsage.totalObjects,
    limitBytes: STORAGE_LIMIT_BYTES || null,
    limitMb: STORAGE_LIMIT_MB || null,
    limitFormatted: STORAGE_LIMIT_BYTES ? formatMb(STORAGE_LIMIT_BYTES) : null,
    percentUsed,
    remainingBytes: STORAGE_LIMIT_BYTES ? Math.max(STORAGE_LIMIT_BYTES - currentBytes, 0) : null,
    remainingMb: STORAGE_LIMIT_BYTES
      ? Number((Math.max(STORAGE_LIMIT_BYTES - currentBytes, 0) / 1024 / 1024).toFixed(2))
      : null,
    uploadBytes,
    nextBytes,
    isLimitEnabled: Boolean(STORAGE_LIMIT_BYTES),
    isOverLimit: Boolean(STORAGE_LIMIT_BYTES && currentBytes >= STORAGE_LIMIT_BYTES),
    wouldExceedLimit: Boolean(STORAGE_LIMIT_BYTES && nextBytes > STORAGE_LIMIT_BYTES),
    shouldBlockUploads: Boolean(STORAGE_LIMIT_BYTES && currentBytes >= STORAGE_LIMIT_BYTES)
  };
}

async function assertStorageLimit(uploadBytes) {
  if (!STORAGE_LIMIT_BYTES) {
    return null;
  }

  const usage = await getStorageUsage(uploadBytes);

  if (!usage.wouldExceedLimit) {
    return null;
  }

  return {
    currentBytes: usage.currentBytes,
    uploadBytes: usage.uploadBytes,
    limitBytes: usage.limitBytes,
    message: `Limite de armazenamento atingido. Uso atual: ${usage.currentFormatted}. Upload solicitado: ${formatMb(uploadBytes)}. Limite configurado: ${usage.limitFormatted}.`
  };
}

async function findCategory(id) {
  return prisma.stickerCategory.findUnique({
    where: { id },
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
}

async function setCategoryCover(categoryId, imageId) {
  if (!imageId) {
    await prisma.stickerCategoryCover.deleteMany({ where: { categoryId } });
    return;
  }

  await prisma.stickerCategoryCover.upsert({
    where: { categoryId },
    create: { categoryId, imageId },
    update: { imageId }
  });
}

async function validateCategoryImage(categoryId, imageId) {
  const image = await prisma.stickerImage.findFirst({
    where: { id: imageId, categoryId }
  });

  return image;
}

router.get("/categories", async (_req, res) => {
  const categories = await prisma.stickerCategory.findMany({
    orderBy: { title: "asc" },
    include: {
      cover: { include: { image: true } },
      images: {
        orderBy: { createdAt: "asc" },
        take: 1
      },
      _count: { select: { images: true } }
    }
  });

  return res.json({ categories: categories.map(categoryResponse) });
});

router.get("/storage-usage", async (_req, res) => {
  const usage = await getStorageUsage();

  return res.json({
    ok: true,
    storage: usage
  });
});

router.get("/categories/:id", async (req, res) => {
  const category = await prisma.stickerCategory.findUnique({
    where: { id: req.params.id },
    include: {
      cover: { include: { image: true } },
      images: {
        orderBy: { createdAt: "asc" }
      },
      _count: { select: { images: true } }
    }
  });

  if (!category) {
    return res.status(404).json({ error: "Categoria nao encontrada." });
  }

  return res.json({
    category: categoryResponse(category),
    images: category.images.map(imageResponse)
  });
});

router.post("/categories", async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Informe titulo e descricao validos." });
  }

  const category = await prisma.stickerCategory.create({
    data: {
      title: parsed.data.title,
      slug: await uniqueSlug(parsed.data.title),
      description: parsed.data.description || null
    },
    include: {
      cover: {
        include: { image: true }
      },
      images: { take: 1 },
      _count: { select: { images: true } }
    }
  });

  return res.status(201).json({ category: categoryResponse(category) });
});

router.patch("/categories/:id", async (req, res) => {
  const parsed = categoryPatchSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos para atualizar categoria." });
  }

  const category = await prisma.stickerCategory.findUnique({ where: { id: req.params.id } });

  if (!category) {
    return res.status(404).json({ error: "Categoria nao encontrada." });
  }

  if (parsed.data.coverImageId) {
    const coverImage = await validateCategoryImage(category.id, parsed.data.coverImageId);

    if (!coverImage) {
      return res.status(400).json({ error: "A capa precisa ser uma imagem desta categoria." });
    }
  }

  const updated = await prisma.stickerCategory.update({
    where: { id: category.id },
    data: {
      title: parsed.data.title,
      slug: parsed.data.title ? await uniqueSlug(parsed.data.title, category.id) : undefined,
      description: Object.prototype.hasOwnProperty.call(parsed.data, "description")
        ? parsed.data.description || null
        : undefined
    },
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

  if (Object.prototype.hasOwnProperty.call(parsed.data, "coverImageId")) {
    await setCategoryCover(category.id, parsed.data.coverImageId);
  }

  const categoryWithCover = await findCategory(category.id);

  return res.json({ category: categoryResponse(categoryWithCover || updated) });
});

router.delete("/categories/:id", async (req, res) => {
  const category = await prisma.stickerCategory.findUnique({
    where: { id: req.params.id },
    include: { images: true }
  });

  if (!category) {
    return res.status(404).json({ error: "Categoria nao encontrada." });
  }

  try {
    await prisma.$transaction([
      prisma.stickerCategoryCover.deleteMany({
        where: { categoryId: category.id }
      }),
      prisma.stickerImage.deleteMany({
        where: { categoryId: category.id }
      }),
      prisma.stickerCategory.delete({
        where: { id: category.id }
      })
    ]);
  } catch (error) {
    console.error("[admin:stickers] Falha ao excluir categoria.", {
      categoryId: category.id,
      message: error.message
    });

    return res.status(500).json({
      error: "Falha ao excluir categoria.",
      message: error.message
    });
  }

  for (const image of category.images) {
    deleteStickerFile(image.storageKey).catch(() => {});
  }

  return res.json({
    ok: true,
    deletedCategoryId: category.id,
    deletedImages: category.images.length
  });
});

router.post(
  "/categories/:id/images",
  parseMultipartFiles({ fieldName: "files", maxTotalBytes: MAX_TOTAL_BYTES }),
  async (req, res) => {
    const category = await prisma.stickerCategory.findUnique({
      where: { id: req.params.id },
      include: { cover: true }
    });

    if (!category) {
      return res.status(404).json({ error: "Categoria nao encontrada." });
    }

    if (!req.files?.length) {
      return res.status(400).json({ error: "Envie ao menos uma imagem no campo files." });
    }

    if (req.files.length > MAX_FILES) {
      return res.status(400).json({ error: `Envie no maximo ${MAX_FILES} arquivos por upload.` });
    }

    let preparedFiles;

    try {
      preparedFiles = req.files.map((file) => ({
        file,
        detected: assertAllowedImage(file, MAX_IMAGE_BYTES)
      }));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const uploadBytes = preparedFiles.reduce(
      (total, prepared) => total + prepared.file.buffer.length,
      0
    );
    const storageLimitError = await assertStorageLimit(uploadBytes);

    if (storageLimitError) {
      return res.status(413).json({
        error: "Limite de armazenamento atingido.",
        message: storageLimitError.message,
        storage: {
          currentBytes: storageLimitError.currentBytes,
          uploadBytes: storageLimitError.uploadBytes,
          limitBytes: storageLimitError.limitBytes
        }
      });
    }

    const createdImages = [];
    const savedStorageKeys = [];

    try {
      for (const prepared of preparedFiles) {
        const savedFile = await saveStickerFile({
          categoryId: category.id,
          originalName: prepared.file.originalName,
          buffer: prepared.file.buffer,
          extension: prepared.detected.extension,
          mimeType: prepared.detected.mimeType
        });
        savedStorageKeys.push(savedFile.storageKey);

        const image = await prisma.stickerImage.create({
          data: {
            categoryId: category.id,
            originalName: savedFile.originalName,
            filename: savedFile.filename,
            mimeType: prepared.detected.mimeType,
            size: savedFile.size,
            storageKey: savedFile.storageKey
          }
        });

        createdImages.push(image);
      }
    } catch (error) {
      if (createdImages.length) {
        await prisma.stickerImage.deleteMany({
          where: { id: { in: createdImages.map((image) => image.id) } }
        }).catch(() => {});
      }

      for (const storageKey of savedStorageKeys) {
        deleteStickerFile(storageKey).catch(() => {});
      }

      console.error("[admin:stickers] Falha ao salvar upload.", error);
      return res.status(500).json({ error: "Falha ao salvar imagens." });
    }

    if (!category.cover && createdImages[0]) {
      await setCategoryCover(category.id, createdImages[0].id);
    }

    const updatedCategory = await findCategory(category.id);

    return res.status(201).json({
      uploaded: createdImages.length,
      category: categoryResponse(updatedCategory),
      images: createdImages.map(imageResponse)
    });
  }
);

router.put("/categories/:id/cover", async (req, res) => {
  const parsed = z.object({ imageId: z.string().uuid() }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Informe imageId valido." });
  }

  const category = await prisma.stickerCategory.findUnique({ where: { id: req.params.id } });

  if (!category) {
    return res.status(404).json({ error: "Categoria nao encontrada." });
  }

  const image = await validateCategoryImage(category.id, parsed.data.imageId);

  if (!image) {
    return res.status(400).json({ error: "A capa precisa ser uma imagem desta categoria." });
  }

  await setCategoryCover(category.id, image.id);

  const updatedCategory = await findCategory(category.id);

  return res.json({ category: categoryResponse(updatedCategory) });
});

router.delete("/categories/:id/cover", async (req, res) => {
  const category = await prisma.stickerCategory.findUnique({ where: { id: req.params.id } });

  if (!category) {
    return res.status(404).json({ error: "Categoria nao encontrada." });
  }

  await setCategoryCover(category.id, null);

  const updatedCategory = await findCategory(category.id);

  return res.json({ category: categoryResponse(updatedCategory) });
});

router.patch("/images/:id", async (req, res) => {
  const parsed = z.object({
    originalName: z.string().trim().min(1).max(255).optional(),
    name: z.string().trim().min(1).max(255).optional()
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Informe um nome valido para a figurinha." });
  }

  const nextName = parsed.data.originalName || parsed.data.name;

  if (!nextName) {
    return res.status(400).json({ error: "Informe originalName ou name." });
  }

  const image = await prisma.stickerImage.update({
    where: { id: req.params.id },
    data: { originalName: nextName }
  }).catch(() => null);

  if (!image) {
    return res.status(404).json({ error: "Figurinha nao encontrada." });
  }

  return res.json({ image: imageResponse(image) });
});

router.delete("/images/:id", async (req, res) => {
  const image = await prisma.stickerImage.findUnique({
    where: { id: req.params.id },
    include: { category: true }
  });

  if (!image) {
    return res.status(404).json({ error: "Figurinha nao encontrada." });
  }

  try {
    await prisma.$transaction([
      prisma.stickerCategoryCover.deleteMany({
        where: { imageId: image.id }
      }),
      prisma.stickerImage.delete({
        where: { id: image.id }
      })
    ]);
  } catch (error) {
    console.error("[admin:stickers] Falha ao excluir figurinha.", {
      imageId: image.id,
      message: error.message
    });

    return res.status(500).json({
      error: "Falha ao excluir figurinha.",
      message: error.message
    });
  }

  deleteStickerFile(image.storageKey).catch(() => {});

  const category = await findCategory(image.categoryId);

  return res.json({
    ok: true,
    deletedImageId: image.id,
    category: category ? categoryResponse(category) : null
  });
});

module.exports = router;
