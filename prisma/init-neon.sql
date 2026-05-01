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
  "coverImageId" TEXT,
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
    WHERE conname = 'StickerCategory_coverImageId_fkey'
  ) THEN
    ALTER TABLE "StickerCategory"
    ADD CONSTRAINT "StickerCategory_coverImageId_fkey"
    FOREIGN KEY ("coverImageId") REFERENCES "StickerImage"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
