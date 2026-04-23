import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { Supplier } from "../models/Supplier.js";
import { Purchase } from "../models/Purchase.js";
import { AppSettings } from "../models/AppSettings.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();
const PRODUCT_UNITS = ["dona", "kg", "blok", "pachka", "qop"];
const PRICING_MODES = ["keep_old", "replace_all", "average"];

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function getUsdRate(tenantId) {
  const settings = await AppSettings.findOne({ tenantId }).lean();
  const rate = Number(settings?.usdRate || 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 12171;
}

function convertToUzs(value, priceCurrency, usdRate) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  if (priceCurrency === "usd") return roundMoney(numeric * usdRate);
  return roundMoney(numeric);
}

function parsePayload(body, usdRate) {
  const allowPieceSale = Boolean(body?.allowPieceSale);
  const paymentType = String(body?.paymentType || "naqd").toLowerCase();
  const priceCurrency = String(body?.priceCurrency || "uzs").toLowerCase();
  const quantity = Number(body?.quantity);
  const purchasePrice = convertToUzs(body?.purchasePrice, priceCurrency, usdRate);
  const totalPurchaseCost = roundMoney(quantity * purchasePrice);
  const rawPaid = convertToUzs(body?.paidAmount, priceCurrency, usdRate);
  const paidAmount = paymentType === "naqd"
    ? totalPurchaseCost
    : paymentType === "qarz"
      ? 0
      : rawPaid;
  const debtAmount = Math.max(0, totalPurchaseCost - (Number.isNaN(paidAmount) ? 0 : paidAmount));

  return {
    name: String(body?.name || "").trim(),
    model: String(body?.model || "").trim(),
    categoryId: String(body?.categoryId || "").trim(),
    supplierId: String(body?.supplierId || "").trim(),
    purchasePrice,
    priceCurrency,
    usdRateUsed: usdRate,
    totalPurchaseCost: Number.isFinite(totalPurchaseCost) ? totalPurchaseCost : 0,
    retailPrice: convertToUzs(body?.retailPrice, priceCurrency, usdRate),
    wholesalePrice: convertToUzs(body?.wholesalePrice, priceCurrency, usdRate),
    paymentType,
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
    debtAmount,
    quantity,
    unit: String(body?.unit || "").trim().toLowerCase(),
    allowPieceSale,
    pieceUnit: String(body?.pieceUnit || "kg").trim().toLowerCase(),
    pieceQtyPerBase: Number(body?.pieceQtyPerBase),
    piecePrice: convertToUzs(body?.piecePrice, priceCurrency, usdRate)
  };
}

function validatePayload(payload) {
  if (!payload.name || !payload.model || !payload.unit || !payload.categoryId || !payload.supplierId) {
    return "Barcha maydonlarni to'ldiring";
  }
  if ([payload.purchasePrice, payload.retailPrice, payload.wholesalePrice, payload.quantity, payload.paidAmount].some((n) => Number.isNaN(n) || n < 0)) {
    return "Narx va miqdor manfiy bo'lmasligi kerak";
  }
  if (!["uzs", "usd"].includes(payload.priceCurrency)) return "Valyuta noto'g'ri";
  if (!["naqd", "qarz", "qisman"].includes(payload.paymentType)) return "To'lov turi noto'g'ri";
  if (payload.paidAmount > payload.totalPurchaseCost) return "To'langan summa umumiy summadan katta bo'lmasin";
  if (!PRODUCT_UNITS.includes(payload.unit)) {
    return "Birlik faqat: dona, kg, blok, pachka, qop";
  }
  if (payload.allowPieceSale) {
    if (!PRODUCT_UNITS.includes(payload.pieceUnit)) {
      return "Parcha birlik noto'g'ri";
    }
    if (
      Number.isNaN(payload.pieceQtyPerBase) ||
      payload.pieceQtyPerBase <= 0 ||
      Number.isNaN(payload.piecePrice) ||
      payload.piecePrice <= 0
    ) {
      return "Parcha sotuv uchun miqdor va narx 0 dan katta bo'lishi kerak";
    }
  }
  return null;
}

async function getOrCreateProductSettings(tenantId) {
  let settings = await AppSettings.findOne({ tenantId });
  if (!settings) {
    settings = await AppSettings.create({ tenantId, topProductIds: [] });
  } else if (!Array.isArray(settings.topProductIds)) {
    settings.topProductIds = [];
    await settings.save();
  }
  return settings;
}

router.get("/", authMiddleware, async (req, res) => {
  const query = tenantFilter(req);
  if (req.query.categoryId) {
    query.categoryId = req.query.categoryId;
  }

  const products = await Product.find(query)
    .populate({ path: "categoryId", select: "name" })
    .populate({ path: "supplierId", select: "name phone address" })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ products });
});

router.get("/top", authMiddleware, async (req, res) => {
  const settings = await getOrCreateProductSettings(req.user.tenantId);
  const ids = (settings.topProductIds || []).map((item) => String(item));
  if (!ids.length) {
    return res.json({ products: [] });
  }

  const products = await Product.find(tenantFilter(req, { _id: { $in: ids } }))
    .populate({ path: "categoryId", select: "name" })
    .populate({ path: "supplierId", select: "name phone address" })
    .lean();

  const ordered = ids
    .map((id) => products.find((product) => String(product._id) === id))
    .filter(Boolean);

  res.json({ products: ordered });
});

router.put("/top", authMiddleware, async (req, res) => {
  const productIdsRaw = Array.isArray(req.body?.productIds)
    ? req.body.productIds
    : [];
  const productIds = [
    ...new Set(
      productIdsRaw
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ].slice(0, 24);

  if (productIds.length) {
    const matchedProducts = await Product.countDocuments(
      tenantFilter(req, { _id: { $in: productIds } })
    );
    if (matchedProducts !== productIds.length) {
      return res.status(400).json({ message: "TOP mahsulotlardan biri topilmadi" });
    }
  }

  const settings = await getOrCreateProductSettings(req.user.tenantId);
  settings.topProductIds = productIds;
  await settings.save();

  const products = await Product.find(tenantFilter(req, { _id: { $in: productIds } }))
    .populate({ path: "categoryId", select: "name" })
    .populate({ path: "supplierId", select: "name phone address" })
    .lean();

  const ordered = productIds
    .map((id) => products.find((product) => String(product._id) === id))
    .filter(Boolean);

  res.json({ products: ordered });
});

router.post("/", authMiddleware, async (req, res) => {
  const usdRate = await getUsdRate(req.user.tenantId);
  const payload = parsePayload(req.body, usdRate);
  const invalid = validatePayload(payload);
  if (invalid) return res.status(400).json({ message: invalid });

  const categoryExists = await Category.exists(tenantFilter(req, { _id: payload.categoryId }));
  if (!categoryExists) return res.status(400).json({ message: "Kategoriya topilmadi" });
  const supplierExists = await Supplier.exists(tenantFilter(req, { _id: payload.supplierId }));
  if (!supplierExists) return res.status(400).json({ message: "Yetkazib beruvchi topilmadi" });

  const exists = await Product.exists(tenantFilter(req, { name: payload.name, model: payload.model, categoryId: payload.categoryId }));
  if (exists) return res.status(409).json({ message: "Bu mahsulot allaqachon mavjud" });

  const product = await Product.create(withTenant(req, payload));
  await Purchase.create(withTenant(req, {
    entryType: "initial",
    supplierId: payload.supplierId,
    productId: product._id,
    productName: payload.name,
    productModel: payload.model,
    quantity: payload.quantity,
    unit: payload.unit,
    purchasePrice: payload.purchasePrice,
    priceCurrency: payload.priceCurrency,
    usdRateUsed: payload.usdRateUsed,
    totalCost: payload.totalPurchaseCost,
    paidAmount: payload.paidAmount,
    debtAmount: payload.debtAmount,
    paymentType: payload.paymentType,
    pricingMode: "replace_all"
  }));
  res.status(201).json({ product });
});

router.post("/:id/restock", authMiddleware, async (req, res) => {
  const product = await Product.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!product) return res.status(404).json({ message: "Mahsulot topilmadi" });

  const supplierId = String(req.body?.supplierId || "").trim();
  const incomingQuantity = Number(req.body?.quantity);
  const purchasePrice = Number(req.body?.purchasePrice);
  const priceCurrency = String(req.body?.priceCurrency || "uzs").toLowerCase();
  const pricingMode = String(req.body?.pricingMode || "keep_old").toLowerCase();
  const paymentType = String(req.body?.paymentType || "naqd").toLowerCase();
  const usdRate = await getUsdRate(req.user.tenantId);
  const purchasePriceUzs = convertToUzs(purchasePrice, priceCurrency, usdRate);
  const retailPriceNew = convertToUzs(req.body?.retailPrice, priceCurrency, usdRate);
  const wholesalePriceNew = convertToUzs(req.body?.wholesalePrice, priceCurrency, usdRate);
  const piecePriceNew = convertToUzs(req.body?.piecePrice, priceCurrency, usdRate);
  const rawPaid = convertToUzs(req.body?.paidAmount, priceCurrency, usdRate);

  if (!supplierId) return res.status(400).json({ message: "Yetkazib beruvchi tanlang" });
  if (!Number.isFinite(incomingQuantity) || incomingQuantity <= 0) {
    return res.status(400).json({ message: "Kirim miqdori 0 dan katta bo'lishi kerak" });
  }
  if (!["uzs", "usd"].includes(priceCurrency)) {
    return res.status(400).json({ message: "Valyuta noto'g'ri" });
  }
  if (!Number.isFinite(purchasePriceUzs) || purchasePriceUzs < 0) {
    return res.status(400).json({ message: "Kelish narxi noto'g'ri" });
  }
  if (!PRICING_MODES.includes(pricingMode)) {
    return res.status(400).json({ message: "Narx strategiyasi noto'g'ri" });
  }
  if (!["naqd", "qarz", "qisman"].includes(paymentType)) {
    return res.status(400).json({ message: "To'lov turi noto'g'ri" });
  }

  const supplierExists = await Supplier.exists(tenantFilter(req, { _id: supplierId }));
  if (!supplierExists) return res.status(400).json({ message: "Yetkazib beruvchi topilmadi" });

  if (pricingMode !== "keep_old") {
    if (!Number.isFinite(retailPriceNew) || retailPriceNew < 0) {
      return res.status(400).json({ message: "Yangi chakana narx noto'g'ri" });
    }
    if (!Number.isFinite(wholesalePriceNew) || wholesalePriceNew < 0) {
      return res.status(400).json({ message: "Yangi optom narx noto'g'ri" });
    }
    if (product.allowPieceSale && (!Number.isFinite(piecePriceNew) || piecePriceNew <= 0)) {
      return res.status(400).json({ message: "Yangi parcha narx noto'g'ri" });
    }
  }

  const incomingTotal = roundMoney(incomingQuantity * purchasePriceUzs);
  const paidAmount = paymentType === "naqd" ? incomingTotal : paymentType === "qarz" ? 0 : rawPaid;
  if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > incomingTotal) {
    return res.status(400).json({ message: "To'langan summa noto'g'ri" });
  }
  const debtAmount = incomingTotal - paidAmount;

  const oldQty = Number(product.quantity) || 0;
  const newQty = oldQty + incomingQuantity;

  const oldRetail = Number(product.retailPrice) || 0;
  const oldWholesale = Number(product.wholesalePrice) || 0;
  const oldPiecePrice = Number(product.piecePrice) || 0;

  let retailPrice = oldRetail;
  let wholesalePrice = oldWholesale;
  let piecePrice = oldPiecePrice;

  if (pricingMode === "replace_all") {
    retailPrice = retailPriceNew;
    wholesalePrice = wholesalePriceNew;
    if (product.allowPieceSale) piecePrice = piecePriceNew;
  } else if (pricingMode === "average") {
    retailPrice = (oldRetail + retailPriceNew) / 2;
    wholesalePrice = (oldWholesale + wholesalePriceNew) / 2;
    if (product.allowPieceSale) piecePrice = (oldPiecePrice + piecePriceNew) / 2;
  }

  const oldCost = Number(product.purchasePrice) || 0;
  const weightedPurchasePrice = newQty > 0
    ? ((oldCost * oldQty) + incomingTotal) / newQty
    : purchasePriceUzs;

  product.quantity = newQty;
  product.purchasePrice = weightedPurchasePrice;
  product.priceCurrency = priceCurrency;
  product.usdRateUsed = usdRate;
  product.totalPurchaseCost = incomingTotal;
  product.retailPrice = retailPrice;
  product.wholesalePrice = wholesalePrice;
  if (product.allowPieceSale) {
    product.piecePrice = piecePrice;
  }
  product.supplierId = supplierId;
  product.paymentType = paymentType;
  product.paidAmount = paidAmount;
  product.debtAmount = debtAmount;

  await product.save();

  await Purchase.create(withTenant(req, {
    entryType: "restock",
    supplierId,
    productId: product._id,
    productName: product.name,
    productModel: product.model,
    quantity: incomingQuantity,
    unit: product.unit,
    purchasePrice: purchasePriceUzs,
    priceCurrency,
    usdRateUsed: usdRate,
    totalCost: incomingTotal,
    paidAmount,
    debtAmount,
    paymentType,
    pricingMode
  }));

  return res.json({ product });
});

router.put("/:id", authMiddleware, async (req, res) => {
  const usdRate = await getUsdRate(req.user.tenantId);
  const payload = parsePayload(req.body, usdRate);
  const invalid = validatePayload(payload);
  if (invalid) return res.status(400).json({ message: invalid });

  const categoryExists = await Category.exists(tenantFilter(req, { _id: payload.categoryId }));
  if (!categoryExists) return res.status(400).json({ message: "Kategoriya topilmadi" });
  const supplierExists = await Supplier.exists(tenantFilter(req, { _id: payload.supplierId }));
  if (!supplierExists) return res.status(400).json({ message: "Yetkazib beruvchi topilmadi" });

  const duplicate = await Product.exists(tenantFilter(req, { name: payload.name, model: payload.model, categoryId: payload.categoryId, _id: { $ne: req.params.id } }));
  if (duplicate) return res.status(409).json({ message: "Bu mahsulot allaqachon mavjud" });

  const existing = await Product.findOne(tenantFilter(req, { _id: req.params.id })).lean();
  if (!existing) return res.status(404).json({ message: "Mahsulot topilmadi" });

  const oldQty = Number(existing.quantity) || 0;
  const nextQty = Number(payload.quantity) || 0;
  const qtyDelta = roundMoney(nextQty - oldQty);

  if (qtyDelta < 0) {
    return res.status(400).json({
      message: "Miqdorni kamaytirish uchun sotuv yoki qaytaruvdan foydalaning. Edit faqat oshirishga ruxsat beradi."
    });
  }

  const updated = await Product.findOneAndUpdate(tenantFilter(req, { _id: req.params.id }), payload, { new: true, runValidators: true });
  if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });

  if (qtyDelta > 0) {
    const incomingTotal = roundMoney(qtyDelta * (Number(payload.purchasePrice) || 0));
    const paidAmount = payload.paymentType === "naqd"
      ? incomingTotal
      : payload.paymentType === "qarz"
        ? 0
        : Math.min(incomingTotal, Number(payload.paidAmount) || 0);
    const debtAmount = Math.max(0, incomingTotal - paidAmount);

    await Purchase.create(withTenant(req, {
      entryType: "restock",
      supplierId: payload.supplierId,
      productId: updated._id,
      productName: payload.name,
      productModel: payload.model,
      quantity: qtyDelta,
      unit: payload.unit,
      purchasePrice: payload.purchasePrice,
      priceCurrency: payload.priceCurrency,
      usdRateUsed: payload.usdRateUsed,
      totalCost: incomingTotal,
      paidAmount,
      debtAmount,
      paymentType: payload.paymentType,
      pricingMode: "replace_all"
    }));
  }

  res.json({ product: updated });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const deleted = await Product.findOneAndDelete(tenantFilter(req, { _id: req.params.id }));
  if (!deleted) return res.status(404).json({ message: "Mahsulot topilmadi" });
  res.json({ ok: true });
});

export default router;
