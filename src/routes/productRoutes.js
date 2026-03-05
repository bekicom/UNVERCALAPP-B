import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { Supplier } from "../models/Supplier.js";
import { Purchase } from "../models/Purchase.js";

const router = Router();
const PRODUCT_UNITS = ["dona", "kg", "blok", "pachka", "qop"];
const PRICING_MODES = ["keep_old", "replace_all", "average"];

function parsePayload(body) {
  const allowPieceSale = Boolean(body?.allowPieceSale);
  const paymentType = String(body?.paymentType || "naqd").toLowerCase();
  const quantity = Number(body?.quantity);
  const purchasePrice = Number(body?.purchasePrice);
  const totalPurchaseCost = quantity * purchasePrice;
  const rawPaid = Number(body?.paidAmount);
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
    totalPurchaseCost: Number.isFinite(totalPurchaseCost) ? totalPurchaseCost : 0,
    retailPrice: Number(body?.retailPrice),
    wholesalePrice: Number(body?.wholesalePrice),
    paymentType,
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
    debtAmount,
    quantity,
    unit: String(body?.unit || "").trim().toLowerCase(),
    allowPieceSale,
    pieceUnit: String(body?.pieceUnit || "kg").trim().toLowerCase(),
    pieceQtyPerBase: Number(body?.pieceQtyPerBase),
    piecePrice: Number(body?.piecePrice)
  };
}

function validatePayload(payload) {
  if (!payload.name || !payload.model || !payload.unit || !payload.categoryId || !payload.supplierId) {
    return "Barcha maydonlarni to'ldiring";
  }
  if ([payload.purchasePrice, payload.retailPrice, payload.wholesalePrice, payload.quantity, payload.paidAmount].some((n) => Number.isNaN(n) || n < 0)) {
    return "Narx va miqdor manfiy bo'lmasligi kerak";
  }
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

router.get("/", authMiddleware, async (req, res) => {
  const query = {};
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

router.post("/", authMiddleware, async (req, res) => {
  const payload = parsePayload(req.body);
  const invalid = validatePayload(payload);
  if (invalid) return res.status(400).json({ message: invalid });

  const categoryExists = await Category.exists({ _id: payload.categoryId });
  if (!categoryExists) return res.status(400).json({ message: "Kategoriya topilmadi" });
  const supplierExists = await Supplier.exists({ _id: payload.supplierId });
  if (!supplierExists) return res.status(400).json({ message: "Yetkazib beruvchi topilmadi" });

  const exists = await Product.exists({ name: payload.name, model: payload.model, categoryId: payload.categoryId });
  if (exists) return res.status(409).json({ message: "Bu mahsulot allaqachon mavjud" });

  const product = await Product.create(payload);
  await Purchase.create({
    entryType: "initial",
    supplierId: payload.supplierId,
    productId: product._id,
    productName: payload.name,
    productModel: payload.model,
    quantity: payload.quantity,
    unit: payload.unit,
    purchasePrice: payload.purchasePrice,
    totalCost: payload.totalPurchaseCost,
    paidAmount: payload.paidAmount,
    debtAmount: payload.debtAmount,
    paymentType: payload.paymentType,
    pricingMode: "replace_all"
  });
  res.status(201).json({ product });
});

router.post("/:id/restock", authMiddleware, async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Mahsulot topilmadi" });

  const supplierId = String(req.body?.supplierId || "").trim();
  const incomingQuantity = Number(req.body?.quantity);
  const purchasePrice = Number(req.body?.purchasePrice);
  const retailPriceNew = Number(req.body?.retailPrice);
  const wholesalePriceNew = Number(req.body?.wholesalePrice);
  const piecePriceNew = Number(req.body?.piecePrice);
  const pricingMode = String(req.body?.pricingMode || "keep_old").toLowerCase();
  const paymentType = String(req.body?.paymentType || "naqd").toLowerCase();
  const rawPaid = Number(req.body?.paidAmount);

  if (!supplierId) return res.status(400).json({ message: "Yetkazib beruvchi tanlang" });
  if (!Number.isFinite(incomingQuantity) || incomingQuantity <= 0) {
    return res.status(400).json({ message: "Kirim miqdori 0 dan katta bo'lishi kerak" });
  }
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    return res.status(400).json({ message: "Kelish narxi noto'g'ri" });
  }
  if (!PRICING_MODES.includes(pricingMode)) {
    return res.status(400).json({ message: "Narx strategiyasi noto'g'ri" });
  }
  if (!["naqd", "qarz", "qisman"].includes(paymentType)) {
    return res.status(400).json({ message: "To'lov turi noto'g'ri" });
  }

  const supplierExists = await Supplier.exists({ _id: supplierId });
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

  const incomingTotal = incomingQuantity * purchasePrice;
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
    : purchasePrice;

  product.quantity = newQty;
  product.purchasePrice = weightedPurchasePrice;
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

  await Purchase.create({
    entryType: "restock",
    supplierId,
    productId: product._id,
    productName: product.name,
    productModel: product.model,
    quantity: incomingQuantity,
    unit: product.unit,
    purchasePrice,
    totalCost: incomingTotal,
    paidAmount,
    debtAmount,
    paymentType,
    pricingMode
  });

  return res.json({ product });
});

router.put("/:id", authMiddleware, async (req, res) => {
  const payload = parsePayload(req.body);
  const invalid = validatePayload(payload);
  if (invalid) return res.status(400).json({ message: invalid });

  const categoryExists = await Category.exists({ _id: payload.categoryId });
  if (!categoryExists) return res.status(400).json({ message: "Kategoriya topilmadi" });
  const supplierExists = await Supplier.exists({ _id: payload.supplierId });
  if (!supplierExists) return res.status(400).json({ message: "Yetkazib beruvchi topilmadi" });

  const duplicate = await Product.exists({ name: payload.name, model: payload.model, categoryId: payload.categoryId, _id: { $ne: req.params.id } });
  if (duplicate) return res.status(409).json({ message: "Bu mahsulot allaqachon mavjud" });

  const updated = await Product.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
  if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });

  res.json({ product: updated });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const deleted = await Product.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ message: "Mahsulot topilmadi" });
  res.json({ ok: true });
});

export default router;
