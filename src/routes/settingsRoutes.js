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

async function getOrCreateSettings() {
  let settings = await AppSettings.findOne();
  if (!settings) {
    settings = await AppSettings.create({});
  }
  return settings;
}

router.get("/", authMiddleware, async (_, res) => {
  const settings = await getOrCreateSettings();
  res.json({ settings });
});

router.put("/", authMiddleware, requireAdmin, async (req, res) => {
  const lowStockThreshold = Number(req.body?.lowStockThreshold);
  const keyboardEnabled = Boolean(req.body?.keyboardEnabled);
  const title = String(req.body?.receipt?.title || "").trim();
  const footer = String(req.body?.receipt?.footer || "").trim();
  const logoUrl = String(req.body?.receipt?.logoUrl || "").trim();

  if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
    return res.status(400).json({ message: "Minimal qoldiq soni noto'g'ri" });
  }

  const settings = await getOrCreateSettings();
  settings.lowStockThreshold = lowStockThreshold;
  settings.keyboardEnabled = keyboardEnabled;
  settings.receipt = {
    title: title || "CHEK",
    footer: footer || "Xaridingiz uchun rahmat!",
    logoUrl
  };
  await settings.save();

  res.json({ settings });
});

export default router;
