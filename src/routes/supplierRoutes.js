import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Supplier } from "../models/Supplier.js";
import { Product } from "../models/Product.js";
import { Purchase } from "../models/Purchase.js";
import { SupplierPayment } from "../models/SupplierPayment.js";

const router = Router();
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");

router.get("/", authMiddleware, async (_, res) => {
  const suppliers = await Supplier.find().sort({ name: 1 }).lean();

  const stats = await Purchase.aggregate([
    { $match: { supplierId: { $ne: null } } },
    {
      $group: {
        _id: "$supplierId",
        totalPurchase: { $sum: "$totalCost" },
        totalPaid: { $sum: "$paidAmount" },
        totalDebt: { $sum: "$debtAmount" }
      }
    }
  ]);

  const statsMap = new Map(stats.map((s) => [String(s._id), s]));
  const result = suppliers.map((s) => {
    const st = statsMap.get(String(s._id));
    return {
      ...s,
      stats: {
        totalPurchase: st?.totalPurchase || 0,
        totalPaid: st?.totalPaid || 0,
        totalDebt: st?.totalDebt || 0
      }
    };
  });

  res.json({ suppliers: result });
});

router.get("/:id/purchases", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const supplier = await Supplier.findById(id).lean();
  if (!supplier) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });

  const purchases = await Purchase.find({ supplierId: id }).sort({ purchasedAt: -1 }).lean();
  const payments = await SupplierPayment.find({ supplierId: id }).sort({ paidAt: -1 }).lean();

  const daily = await Purchase.aggregate([
    { $match: { supplierId: supplier._id } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$purchasedAt" } },
        totalCost: { $sum: "$totalCost" },
        totalPaid: { $sum: "$paidAmount" },
        totalDebt: { $sum: "$debtAmount" },
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
      return acc;
    },
    { totalPurchase: 0, totalPaid: 0, totalDebt: 0 }
  );

  res.json({ supplier, purchases, daily, payments, totals });
});

router.get("/:id/payments", authMiddleware, async (req, res) => {
  const supplier = await Supplier.findById(req.params.id).lean();
  if (!supplier) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });

  const payments = await SupplierPayment.find({ supplierId: supplier._id }).sort({ paidAt: -1 }).lean();
  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  res.json({ supplier, payments, totalPaid });
});

router.post("/:id/payments", authMiddleware, async (req, res) => {
  const supplier = await Supplier.findById(req.params.id).lean();
  if (!supplier) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });

  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || "").trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "To'lov summasi 0 dan katta bo'lishi kerak" });
  }

  const debtPurchases = await Purchase.find({
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

  const payment = await SupplierPayment.create({
    supplierId: supplier._id,
    amount: payable,
    note,
    allocations
  });

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

  if (!name) return res.status(400).json({ message: "Yetkazib beruvchi nomi kerak" });

  const exists = await Supplier.exists({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } });
  if (exists) return res.status(409).json({ message: "Bu yetkazib beruvchi mavjud" });

  const supplier = await Supplier.create({ name, address, phone });
  res.status(201).json({ supplier });
});

router.put("/:id", authMiddleware, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const address = String(req.body?.address || "").trim();
  const phone = String(req.body?.phone || "").trim();

  if (!name) return res.status(400).json({ message: "Yetkazib beruvchi nomi kerak" });

  const duplicate = await Supplier.exists({
    _id: { $ne: req.params.id },
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" }
  });
  if (duplicate) return res.status(409).json({ message: "Bu yetkazib beruvchi mavjud" });

  const updated = await Supplier.findByIdAndUpdate(
    req.params.id,
    { name, address, phone },
    { new: true, runValidators: true }
  );

  if (!updated) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });
  res.json({ supplier: updated });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const used = await Product.exists({ supplierId: req.params.id });
  if (used) {
    return res.status(400).json({
      message: "Bu yetkazib beruvchi mahsulotlarga bog'langan, o'chirib bo'lmaydi"
    });
  }

  const deleted = await Supplier.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ message: "Yetkazib beruvchi topilmadi" });
  res.json({ ok: true });
});

export default router;
