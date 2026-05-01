CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'USER',
  "hasAccess" BOOLEAN NOT NULL DEFAULT false,
  "temporaryPassword" BOOLEAN NOT NULL DEFAULT true,
  "accessEmailSent" BOOLEAN NOT NULL DEFAULT false,
  "accessEmailSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'USER';

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "accessEmailSent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "accessEmailSentAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "UserProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'USER',
  "temporarilyDisabled" BOOLEAN NOT NULL DEFAULT false,
  "disabledUntil" TIMESTAMP(3),
  "disabledReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserProfile_userId_key" ON "UserProfile"("userId");
CREATE INDEX IF NOT EXISTS "UserProfile_role_idx" ON "UserProfile"("role");
CREATE INDEX IF NOT EXISTS "UserProfile_temporarilyDisabled_idx" ON "UserProfile"("temporarilyDisabled");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UserProfile_userId_fkey'
  ) THEN
    ALTER TABLE "UserProfile"
    ADD CONSTRAINT "UserProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "UserProfile" ("id", "userId", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "role", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("userId") DO NOTHING;

CREATE TABLE IF NOT EXISTS "Purchase" (
  "id" TEXT NOT NULL,
  "caktoSaleId" TEXT NOT NULL,
  "productName" TEXT,
  "customerName" TEXT,
  "customerEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "rawPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,

  CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_caktoSaleId_key" ON "Purchase"("caktoSaleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Purchase_userId_fkey'
  ) THEN
    ALTER TABLE "Purchase"
    ADD CONSTRAINT "Purchase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "StickerCategory" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StickerCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StickerCategory_slug_key" ON "StickerCategory"("slug");

CREATE TABLE IF NOT EXISTS "StickerImage" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StickerImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StickerImage_storageKey_key" ON "StickerImage"("storageKey");
CREATE INDEX IF NOT EXISTS "StickerImage_categoryId_idx" ON "StickerImage"("categoryId");

CREATE TABLE IF NOT EXISTS "StickerCategoryCover" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "imageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StickerCategoryCover_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StickerCategoryCover_categoryId_key"
ON "StickerCategoryCover"("categoryId");

CREATE INDEX IF NOT EXISTS "StickerCategoryCover_imageId_idx"
ON "StickerCategoryCover"("imageId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'StickerImage_categoryId_fkey'
  ) THEN
    ALTER TABLE "StickerImage"
    ADD CONSTRAINT "StickerImage_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "StickerCategory"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'StickerCategoryCover_categoryId_fkey'
  ) THEN
    ALTER TABLE "StickerCategoryCover"
    ADD CONSTRAINT "StickerCategoryCover_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "StickerCategory"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'StickerCategoryCover_imageId_fkey'
  ) THEN
    ALTER TABLE "StickerCategoryCover"
    ADD CONSTRAINT "StickerCategoryCover_imageId_fkey"
    FOREIGN KEY ("imageId") REFERENCES "StickerImage"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'StickerCategory'
      AND column_name = 'coverImageId'
  ) THEN
    INSERT INTO "StickerCategoryCover" ("id", "categoryId", "imageId", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, c."id", c."coverImageId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "StickerCategory" c
    INNER JOIN "StickerImage" i
      ON i."id" = c."coverImageId"
      AND i."categoryId" = c."id"
    WHERE c."coverImageId" IS NOT NULL
    ON CONFLICT ("categoryId") DO UPDATE
      SET "imageId" = EXCLUDED."imageId",
          "updatedAt" = CURRENT_TIMESTAMP;
  END IF;
END $$;
