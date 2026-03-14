import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { AppSettings } from "../models/AppSettings.js";

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Faqat admin uchun" });
  }
  next();
}

async function getOrCreateSettings(tenantId) {
  let settings = await AppSettings.findOne({ tenantId });
  if (!settings) {
    settings = await AppSettings.create({ tenantId });
  } else if (!Number.isFinite(Number(settings.usdRate)) || Number(settings.usdRate) <= 0) {
    settings.usdRate = 12171;
    if (!["uzs", "usd"].includes(String(settings.displayCurrency || "").toLowerCase())) {
      settings.displayCurrency = "uzs";
    }
    await settings.save();
  } else if (!["uzs", "usd"].includes(String(settings.displayCurrency || "").toLowerCase())) {
    settings.displayCurrency = "uzs";
    await settings.save();
  }
  return settings;
}

router.get("/", authMiddleware, async (req, res) => {
  const settings = await getOrCreateSettings(req.user.tenantId);
  res.json({ settings });
});

router.put("/", authMiddleware, requireAdmin, async (req, res) => {
  const lowStockThreshold = Number(req.body?.lowStockThreshold);
  const usdRate = Number(req.body?.usdRate);
  const displayCurrency = String(req.body?.displayCurrency || "uzs").trim().toLowerCase();
  const keyboardEnabled = Boolean(req.body?.keyboardEnabled);
  const title = String(req.body?.receipt?.title || "").trim();
  const footer = String(req.body?.receipt?.footer || "").trim();
  const logoUrl = String(req.body?.receipt?.logoUrl || "").trim();
  const fieldsRaw = req.body?.receipt?.fields || {};

  if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
    return res.status(400).json({ message: "Minimal qoldiq soni noto'g'ri" });
  }
  if (!Number.isFinite(usdRate) || usdRate <= 0) {
    return res.status(400).json({ message: "USD kursi noto'g'ri" });
  }
  if (!["uzs", "usd"].includes(displayCurrency)) {
    return res.status(400).json({ message: "Dastur valyutasi noto'g'ri" });
  }

  const settings = await getOrCreateSettings(req.user.tenantId);
  settings.lowStockThreshold = lowStockThreshold;
  settings.usdRate = usdRate;
  settings.displayCurrency = displayCurrency;
  settings.keyboardEnabled = keyboardEnabled;
  settings.receipt = {
    title: title || "CHEK",
    footer: footer || "Xaridingiz uchun rahmat!",
    logoUrl,
    fields: {
      showDate: fieldsRaw.showDate !== false,
      showCashier: fieldsRaw.showCashier !== false,
      showPaymentType: fieldsRaw.showPaymentType !== false,
      showCustomer: fieldsRaw.showCustomer !== false,
      showItemsTable: fieldsRaw.showItemsTable !== false,
      showItemUnitPrice: fieldsRaw.showItemUnitPrice !== false,
      showItemLineTotal: fieldsRaw.showItemLineTotal !== false,
      showTotal: fieldsRaw.showTotal !== false,
      showFooter: fieldsRaw.showFooter !== false
    }
  };
  await settings.save();

  res.json({ settings });
});

export default router;
