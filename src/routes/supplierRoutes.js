import mongoose from "mongoose";
import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { AppSettings } from "../models/AppSettings.js";
import { Supplier } from "../models/Supplier.js";
import { Product } from "../models/Product.js";
import { Purchase } from "../models/Purchase.js";
import { SupplierPayment } from "../models/SupplierPayment.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function getUsdRate(tenantId) {
  const settings = await AppSettings.findOne({ tenantId }).lean();
  const rate = Number(settings?.usdRate || 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 12171;
}

function convertToUzs(value, currency, usdRate) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return NaN;
  return currency === "usd" ? roundMoney(amount * usdRate) : roundMoney(amount);
}

function normalizeObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
}

router.get("/", authMiddleware, async (req, res) => {
  const suppliers = await Supplier.find(tenantFilter(req)).sort({ name: 1 }).lean();
  const supplierIds = suppliers.map((s) => normalizeObjectId(s._id)).filter(Boolean);
  const tenantId = normalizeObjectId(req.user.tenantId);

  const stats = supplierIds.length > 0 ? await Purchase.aggregate([
    { $match: { tenantId, supplierId: { $in: supplierIds } } },
    {
      $group: {
        _id: "$supplierId",
        totalPurchase: { $sum: "$totalCost" },
        totalPaid: { $sum: "$paidAmount" },
        totalDebt: { $sum: "$debtAmount" },
        totalPurchaseUsd: {
          $sum: {
            $cond: [
              { $eq: ["$priceCurrency", "usd"] },
              { $divide: ["$totalCost", { $ifNull: ["$usdRateUsed", 12171] }] },
              0
            ]
          }
        },
        totalPaidUsd: {
          $sum: {
            $cond: [
              { $eq: ["$priceCurrency", "usd"] },
              { $divide: ["$paidAmount", { $ifNull: ["$usdRateUsed", 12171] }] },
              0
            ]
          }
        },
        totalDebtUsd: {
          $sum: {
            $cond: [
              { $eq: ["$priceCurrency", "usd"] },
              { $divide: ["$debtAmount", { $ifNull: ["$usdRateUsed", 12171] }] },
              0
            ]
          }
        }
      }
    }
  ]) : [];

  const statsMap = new Map(stats.map((s) => [String(s._id), s]));
  const result = suppliers.map((s) => {
    const st = statsMap.get(String(s._id));
    return {
      ...s,
      stats: {
        totalPurchase: st?.totalPurchase || 0,
        totalPaid: st?.totalPaid || 0,
        totalDebt: st?.totalDebt || 0,
        totalPurchaseUsd: roundMoney(st?.totalPurchaseUsd || 0),
        totalPaidUsd: roundMoney(st?.totalPaidUsd || 0),
        totalDebtUsd: roundMoney(st?.totalDebtUsd || 0)
      }
    };
  });

  res.json({ suppliers: result });
});

router.get("/:id/purchases", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const supplier = await Supplier.findOne(tenantFilter(req, { _id: id })).lean();
  if (!supplier) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });
  const tenantId = normalizeObjectId(supplier.tenantId);
  const supplierId = normalizeObjectId(supplier._id);

  const purchases = await Purchase.find({ tenantId, supplierId }).sort({ purchasedAt: -1 }).lean();
  const payments = await SupplierPayment.find({ tenantId, supplierId }).sort({ paidAt: -1 }).lean();

  const daily = await Purchase.aggregate([
    { $match: { tenantId, supplierId } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$purchasedAt" } },
        totalCost: { $sum: "$totalCost" },
        totalPaid: { $sum: "$paidAmount" },
        totalDebt: { $sum: "$debtAmount" },
        totalCostUsd: {
          $sum: {
            $cond: [
              { $eq: ["$priceCurrency", "usd"] },
              { $divide: ["$totalCost", { $ifNull: ["$usdRateUsed", 12171] }] },
              0
            ]
          }
        },
        totalPaidUsd: {
          $sum: {
            $cond: [
              { $eq: ["$priceCurrency", "usd"] },
              { $divide: ["$paidAmount", { $ifNull: ["$usdRateUsed", 12171] }] },
              0
            ]
          }
        },
        totalDebtUsd: {
          $sum: {
            $cond: [
              { $eq: ["$priceCurrency", "usd"] },
              { $divide: ["$debtAmount", { $ifNull: ["$usdRateUsed", 12171] }] },
              0
            ]
          }
        },
        totalQuantity: { $sum: "$quantity" },
        items: { $sum: 1 }
      }
    },
    { $sort: { _id: -1 } }
  ]);

  const totals = purchases.reduce(
    (acc, p) => {
      acc.totalPurchase += Number(p.totalCost) || 0;
      acc.totalPaid += Number(p.paidAmount) || 0;
      acc.totalDebt += Number(p.debtAmount) || 0;
      if (String(p.priceCurrency || "").toLowerCase() === "usd") {
        const rate = Number(p.usdRateUsed || 12171);
        if (rate > 0) {
          acc.totalPurchaseUsd += Number(p.totalCost || 0) / rate;
          acc.totalPaidUsd += Number(p.paidAmount || 0) / rate;
          acc.totalDebtUsd += Number(p.debtAmount || 0) / rate;
        }
      }
      return acc;
    },
    { totalPurchase: 0, totalPaid: 0, totalDebt: 0, totalPurchaseUsd: 0, totalPaidUsd: 0, totalDebtUsd: 0 }
  );

  totals.totalPurchaseUsd = roundMoney(totals.totalPurchaseUsd);
  totals.totalPaidUsd = roundMoney(totals.totalPaidUsd);
  totals.totalDebtUsd = roundMoney(totals.totalDebtUsd);

  const dailyWithUsd = daily.map((d) => ({
    ...d,
    totalCostUsd: roundMoney(d.totalCostUsd || 0),
    totalPaidUsd: roundMoney(d.totalPaidUsd || 0),
    totalDebtUsd: roundMoney(d.totalDebtUsd || 0)
  }));

  res.json({ supplier, purchases, daily: dailyWithUsd, payments, totals });
});

router.get("/:id/payments", authMiddleware, async (req, res) => {
  const supplier = await Supplier.findOne(tenantFilter(req, { _id: req.params.id })).lean();
  if (!supplier) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });

  const payments = await SupplierPayment.find(tenantFilter(req, { supplierId: supplier._id })).sort({ paidAt: -1 }).lean();
  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  res.json({ supplier, payments, totalPaid });
});

router.post("/:id/payments", authMiddleware, async (req, res) => {
  const supplier = await Supplier.findOne(tenantFilter(req, { _id: req.params.id })).lean();
  if (!supplier) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });

  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || "").trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "To'lov summasi 0 dan katta bo'lishi kerak" });
  }

  const debtPurchases = await Purchase.find({
    tenantId: req.user.tenantId,
    supplierId: supplier._id,
    debtAmount: { $gt: 0 }
  }).sort({ purchasedAt: 1, _id: 1 });

  if (debtPurchases.length === 0) {
    return res.status(400).json({ message: "Bu yetkazib beruvchi bo'yicha ochiq qarz yo'q" });
  }

  const totalDebt = debtPurchases.reduce((sum, p) => sum + (Number(p.debtAmount) || 0), 0);
  const payable = Math.min(amount, totalDebt);
  let remaining = payable;
  const allocations = [];

  for (const purchase of debtPurchases) {
    if (remaining <= 0) break;
    const debt = Number(purchase.debtAmount) || 0;
    if (debt <= 0) continue;

    const applied = Math.min(remaining, debt);
    purchase.debtAmount = debt - applied;
    purchase.paidAmount = (Number(purchase.paidAmount) || 0) + applied;
    if (purchase.debtAmount <= 0) {
      purchase.paymentType = "naqd";
    } else {
      purchase.paymentType = "qisman";
    }
    await purchase.save();

    allocations.push({
      purchaseId: purchase._id,
      productName: purchase.productName,
      productModel: purchase.productModel,
      appliedAmount: applied
    });
    remaining -= applied;
  }

  const payment = await SupplierPayment.create(withTenant(req, {
    supplierId: supplier._id,
    amount: payable,
    note,
    allocations
  }));

  const newTotalDebt = Math.max(0, totalDebt - payable);

  return res.status(201).json({
    payment,
    paidAmount: payable,
    totalDebtBefore: totalDebt,
    totalDebtAfter: newTotalDebt
  });
});

router.post("/", authMiddleware, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const address = String(req.body?.address || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const openingBalanceCurrency = String(req.body?.openingBalanceCurrency || "uzs").trim().toLowerCase();

  if (!name) return res.status(400).json({ message: "Yetkazib beruvchi nomi kerak" });
  if (!["uzs", "usd"].includes(openingBalanceCurrency)) {
    return res.status(400).json({ message: "Valyuta noto'g'ri" });
  }

  const exists = await Supplier.exists(tenantFilter(req, { name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } }));
  if (exists) return res.status(409).json({ message: "Bu yetkazib beruvchi mavjud" });

  const usdRate = await getUsdRate(req.user.tenantId);
  const openingBalance = convertToUzs(req.body?.openingBalanceAmount || 0, openingBalanceCurrency, usdRate);
  if (Number.isNaN(openingBalance)) {
    return res.status(400).json({ message: "Boshlang'ich qarz summasi noto'g'ri" });
  }

  const supplier = await Supplier.create(withTenant(req, { name, address, phone }));

  if (openingBalance > 0) {
    await Purchase.create(withTenant(req, {
      entryType: "opening_balance",
      supplierId: supplier._id,
      productId: null,
      productName: "Boshlang'ich astatka",
      productModel: "-",
      quantity: 0,
      unit: "dona",
      purchasePrice: openingBalance,
      priceCurrency: openingBalanceCurrency,
      usdRateUsed: usdRate,
      totalCost: openingBalance,
      paidAmount: 0,
      debtAmount: openingBalance,
      paymentType: "qarz",
      pricingMode: "keep_old"
    }));
  }

  res.status(201).json({ supplier });
});

router.put("/:id", authMiddleware, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const address = String(req.body?.address || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const openingBalanceCurrency = String(req.body?.openingBalanceCurrency || "uzs").trim().toLowerCase();

  if (!name) return res.status(400).json({ message: "Yetkazib beruvchi nomi kerak" });
  if (!["uzs", "usd"].includes(openingBalanceCurrency)) {
    return res.status(400).json({ message: "Valyuta noto'g'ri" });
  }

  const duplicate = await Supplier.exists(tenantFilter(req, {
    _id: { $ne: req.params.id },
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" }
  }));
  if (duplicate) return res.status(409).json({ message: "Bu yetkazib beruvchi mavjud" });

  const usdRate = await getUsdRate(req.user.tenantId);
  const openingBalance = convertToUzs(req.body?.openingBalanceAmount || 0, openingBalanceCurrency, usdRate);
  if (Number.isNaN(openingBalance)) {
    return res.status(400).json({ message: "Boshlang'ich qarz summasi noto'g'ri" });
  }

  const updated = await Supplier.findOneAndUpdate(
    tenantFilter(req, { _id: req.params.id }),
    { name, address, phone },
    { new: true, runValidators: true }
  );

  if (!updated) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });

  if (openingBalance > 0) {
    await Purchase.create(withTenant(req, {
      entryType: "opening_balance",
      supplierId: updated._id,
      productId: null,
      productName: "Boshlang'ich astatka",
      productModel: "-",
      quantity: 0,
      unit: "dona",
      purchasePrice: openingBalance,
      priceCurrency: openingBalanceCurrency,
      usdRateUsed: usdRate,
      totalCost: openingBalance,
      paidAmount: 0,
      debtAmount: openingBalance,
      paymentType: "qarz",
      pricingMode: "keep_old"
    }));
  }

  res.json({ supplier: updated });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const used = await Product.exists(tenantFilter(req, { supplierId: req.params.id }));
  if (used) {
    return res.status(400).json({
      message: "Bu yetkazib beruvchi mahsulotlarga bog'langan, o'chirib bo'lmaydi"
    });
  }

  const deleted = await Supplier.findOneAndDelete(tenantFilter(req, { _id: req.params.id }));
  if (!deleted) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });
  res.json({ ok: true });
});

export default router;
