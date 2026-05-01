const fs = require("fs");
const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { parseMultipartFiles } = require("../lib/multipart-files");
const {
  assertAllowedImage,
  resolveStoragePath,
  saveStickerFile,
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

const MAX_IMAGE_BYTES = Number(process.env.STICKER_UPLOAD_MAX_IMAGE_MB || 20) * 1024 * 1024;
const MAX_FILES = Number(process.env.STICKER_UPLOAD_MAX_FILES || 200);
const MAX_TOTAL_BYTES = Number(process.env.STICKER_UPLOAD_MAX_REQUEST_MB || 512) * 1024 * 1024;

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
  const coverImage = category.coverImage || category.images?.[0] || null;

  return {
    id: category.id,
    slug: category.slug,
    title: category.title,
    description: category.description,
    totalStickers: category._count?.images || 0,
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

async function findCategory(id) {
  return prisma.stickerCategory.findUnique({
    where: { id },
    include: {
      coverImage: true,
      images: {
        orderBy: { createdAt: "asc" },
        take: 1
      },
      _count: { select: { images: true } }
    }
  });
}

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
      coverImage: true,
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
    const coverImage = await prisma.stickerImage.findFirst({
      where: {
        id: parsed.data.coverImageId,
        categoryId: category.id
      }
    });

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
        : undefined,
      coverImageId: Object.prototype.hasOwnProperty.call(parsed.data, "coverImageId")
        ? parsed.data.coverImageId
        : undefined
    },
    include: {
      coverImage: true,
      images: {
        orderBy: { createdAt: "asc" },
        take: 1
      },
      _count: { select: { images: true } }
    }
  });

  return res.json({ category: categoryResponse(updated) });
});

router.delete("/categories/:id", async (req, res) => {
  const category = await prisma.stickerCategory.findUnique({
    where: { id: req.params.id },
    include: { images: true }
  });

  if (!category) {
    return res.status(404).json({ error: "Categoria nao encontrada." });
  }

  await prisma.$transaction([
    prisma.stickerCategory.update({
      where: { id: category.id },
      data: { coverImageId: null }
    }),
    prisma.stickerCategory.delete({ where: { id: category.id } })
  ]);

  for (const image of category.images) {
    fs.promises.unlink(resolveStoragePath(image.storageKey)).catch(() => {});
  }

  return res.json({ ok: true });
});

router.post(
  "/categories/:id/images",
  parseMultipartFiles({ fieldName: "files", maxTotalBytes: MAX_TOTAL_BYTES }),
  async (req, res) => {
    const category = await prisma.stickerCategory.findUnique({
      where: { id: req.params.id },
      select: { id: true, coverImageId: true }
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

    const createdImages = [];
    const savedStorageKeys = [];

    try {
      for (const prepared of preparedFiles) {
        const savedFile = await saveStickerFile({
          categoryId: category.id,
          originalName: prepared.file.originalName,
          buffer: prepared.file.buffer,
          extension: prepared.detected.extension
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
        fs.promises.unlink(resolveStoragePath(storageKey)).catch(() => {});
      }

      console.error("[admin:stickers] Falha ao salvar upload.", error);
      return res.status(500).json({ error: "Falha ao salvar imagens." });
    }

    if (!category.coverImageId && createdImages[0]) {
      await prisma.stickerCategory.update({
        where: { id: category.id },
        data: { coverImageId: createdImages[0].id }
      });
    }

    const updatedCategory = await findCategory(category.id);

    return res.status(201).json({
      uploaded: createdImages.length,
      category: categoryResponse(updatedCategory),
      images: createdImages.map(imageResponse)
    });
  }
);

module.exports = router;
