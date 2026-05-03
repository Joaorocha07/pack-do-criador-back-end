const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getRotationSource() {
  const source = String(process.env.CHECKOUT_ROTATION_SOURCE || "purchases")
    .trim()
    .toLowerCase();

  return source === "users" ? "users" : "purchases";
}

function getCheckoutConfig() {
  return {
    affiliateUrl: process.env.CHECKOUT_AFFILIATE_URL,
    ownUrl: process.env.CHECKOUT_OWN_URL,
    affiliateSlots: parsePositiveInt(
      process.env.CHECKOUT_AFFILIATE_SALES_BEFORE_OWN,
      3
    ),
    source: getRotationSource()
  };
}

async function countRotationBase(source) {
  if (source === "users") {
    return prisma.user.count({
      where: {
        hasAccess: true,
        role: "USER"
      }
    });
  }

  const expectedProduct = process.env.CAKTO_PRODUCT_NAME;

  return prisma.purchase.count({
    where: expectedProduct
      ? {
          productName: {
            equals: expectedProduct,
            mode: "insensitive"
          }
        }
      : undefined
  });
}

router.get("/link", async (req, res) => {
  const config = getCheckoutConfig();

  if (!config.affiliateUrl || !config.ownUrl) {
    return res.status(500).json({
      error:
        "Configure CHECKOUT_AFFILIATE_URL e CHECKOUT_OWN_URL para usar o link de venda."
    });
  }

  const currentCount = await countRotationBase(config.source);
  const cycleSize = config.affiliateSlots + 1;
  const nextPosition = (currentCount % cycleSize) + 1;
  const useOwnLink = nextPosition === 1;
  const url = useOwnLink ? config.ownUrl : config.affiliateUrl;

  if (req.query.redirect === "true") {
    return res.redirect(302, url);
  }

  return res.json({
    url,
    target: useOwnLink ? "own" : "affiliate",
    source: config.source,
    currentCount,
    nextPosition,
    cycleSize,
    affiliateSlots: config.affiliateSlots
  });
});

module.exports = router;
