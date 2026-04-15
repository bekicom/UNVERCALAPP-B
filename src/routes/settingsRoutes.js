import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { AppSettings } from "../models/AppSettings.js";
import { openCashDrawer } from "../cashDrawer.js";

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
  if (typeof settings.posCompactMode !== "boolean") {
    settings.posCompactMode = false;
    await settings.save();
  }
  if (typeof settings.variantInsightsEnabled !== "boolean") {
    settings.variantInsightsEnabled = false;
    await settings.save();
  }

  const currentSize = String(settings.barcodeLabel?.paperSize || "");
  const currentOrientation = String(settings.barcodeLabel?.orientation || "");
  const validSizes = ["58x40", "60x40", "70x50", "80x50"];
  const validOrientations = ["portrait", "landscape"];
  const currentCopies = Number(settings.barcodeLabel?.copies);
  const shouldFixBarcodeLabel =
    !validSizes.includes(currentSize) ||
    !validOrientations.includes(currentOrientation) ||
    !Number.isFinite(currentCopies) ||
    currentCopies < 1;
  if (shouldFixBarcodeLabel) {
    settings.barcodeLabel = {
      ...(settings.barcodeLabel?.toObject ? settings.barcodeLabel.toObject() : settings.barcodeLabel || {}),
      paperSize: validSizes.includes(currentSize) ? currentSize : "58x40",
      orientation: validOrientations.includes(currentOrientation) ? currentOrientation : "portrait",
      copies: Number.isFinite(currentCopies) && currentCopies > 0 ? Math.round(currentCopies) : 1,
      fields: {
        showName: settings.barcodeLabel?.fields?.showName !== false,
        showBarcode: settings.barcodeLabel?.fields?.showBarcode !== false,
        showPrice: settings.barcodeLabel?.fields?.showPrice !== false,
        showModel: settings.barcodeLabel?.fields?.showModel !== false,
        showCategory: settings.barcodeLabel?.fields?.showCategory === true
      }
    };
    await settings.save();
  }
  return settings;
}

router.get("/", authMiddleware, async (req, res) => {
  const settings = await getOrCreateSettings(req.user.tenantId);
  res.json({ settings });
});

router.post("/cash-drawer/open", authMiddleware, async (_req, res) => {
  const result = await openCashDrawer();
  res.json(result);
});

router.put("/", authMiddleware, requireAdmin, async (req, res) => {
  const lowStockThreshold = Number(req.body?.lowStockThreshold);
  const usdRate = Number(req.body?.usdRate);
  const displayCurrency = String(req.body?.displayCurrency || "uzs").trim().toLowerCase();
  const keyboardEnabled = Boolean(req.body?.keyboardEnabled);
  const ustalarEnabled = Boolean(req.body?.ustalarEnabled);
  const posCompactMode = Boolean(req.body?.posCompactMode);
  const variantInsightsEnabled = Boolean(req.body?.variantInsightsEnabled);
  const title = String(req.body?.receipt?.title || "").trim();
  const footer = String(req.body?.receipt?.footer || "").trim();
  const logoUrl = String(req.body?.receipt?.logoUrl || "").trim();
  const fieldsRaw = req.body?.receipt?.fields || {};
  const barcodeLabelRaw = req.body?.barcodeLabel || {};
  const barcodeFieldsRaw = barcodeLabelRaw?.fields || {};
  const barcodePaperSize = String(barcodeLabelRaw?.paperSize || "58x40").trim();
  const barcodeOrientation = String(barcodeLabelRaw?.orientation || "portrait").trim().toLowerCase();
  const barcodeCopies = Number(barcodeLabelRaw?.copies);

  if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
    return res.status(400).json({ message: "Minimal qoldiq soni noto'g'ri" });
  }
  if (!Number.isFinite(usdRate) || usdRate <= 0) {
    return res.status(400).json({ message: "USD kursi noto'g'ri" });
  }
  if (!["uzs", "usd"].includes(displayCurrency)) {
    return res.status(400).json({ message: "Dastur valyutasi noto'g'ri" });
  }
  if (!["58x40", "60x40", "70x50", "80x50"].includes(barcodePaperSize)) {
    return res.status(400).json({ message: "Shtixkod qog'oz o'lchami noto'g'ri" });
  }
  if (!["portrait", "landscape"].includes(barcodeOrientation)) {
    return res.status(400).json({ message: "Shtixkod yo'nalishi noto'g'ri" });
  }
  if (!Number.isFinite(barcodeCopies) || barcodeCopies < 1) {
    return res.status(400).json({ message: "Shtixkod nusxa soni noto'g'ri" });
  }

  const settings = await getOrCreateSettings(req.user.tenantId);
  settings.lowStockThreshold = lowStockThreshold;
  settings.usdRate = usdRate;
  settings.displayCurrency = displayCurrency;
  settings.keyboardEnabled = keyboardEnabled;
  settings.ustalarEnabled = ustalarEnabled;
  settings.posCompactMode = posCompactMode;
  settings.variantInsightsEnabled = variantInsightsEnabled;
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
  settings.barcodeLabel = {
    paperSize: barcodePaperSize,
    orientation: barcodeOrientation,
    copies: Math.max(1, Math.round(barcodeCopies)),
    fields: {
      showName: barcodeFieldsRaw.showName !== false,
      showBarcode: barcodeFieldsRaw.showBarcode !== false,
      showPrice: barcodeFieldsRaw.showPrice !== false,
      showModel: barcodeFieldsRaw.showModel !== false,
      showCategory: barcodeFieldsRaw.showCategory === true
    }
  };
  await settings.save();

  res.json({ settings });
});

export default router;
