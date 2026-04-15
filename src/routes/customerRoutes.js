import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { AppSettings } from "../models/AppSettings.js";
import { Customer } from "../models/Customer.js";
import { CustomerPayment } from "../models/CustomerPayment.js";
import { Sale } from "../models/Sale.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Faqat admin uchun" });
  }
  next();
}

router.get("/", authMiddleware, requireAdmin, async (req, res) => {
  const customers = await Customer.find(tenantFilter(req)).sort({ updatedAt: -1 }).lean();
  const summary = customers.reduce(
    (acc, c) => {
      acc.totalCustomers += 1;
      acc.totalDebt += Number(c.totalDebt || 0);
      acc.totalPaid += Number(c.totalPaid || 0);
      if (Number(c.totalDebt || 0) > 0) acc.activeDebtors += 1;
      return acc;
    },
    { totalCustomers: 0, activeDebtors: 0, totalDebt: 0, totalPaid: 0 }
  );

  res.json({ customers, summary });
});

router.get("/lookup", authMiddleware, async (req, res) => {
  const q = String(req.query?.q || "").trim();
  const query = tenantFilter(req);

  if (q) {
    const safe = escapeRegex(q);
    query.$or = [
      { fullName: { $regex: safe, $options: "i" } },
      { phone: { $regex: safe, $options: "i" } },
      { address: { $regex: safe, $options: "i" } }
    ];
  }

  const customers = await Customer.find(query)
    .select("_id fullName phone address totalDebt")
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();

  res.json({ customers });
});

router.get("/:id/ledger", authMiddleware, requireAdmin, async (req, res) => {
  const customer = await Customer.findOne(tenantFilter(req, { _id: req.params.id })).lean();
  if (!customer) return res.status(404).json({ message: "Mijoz topilmadi" });

  const [sales, payments] = await Promise.all([
    Sale.find(tenantFilter(req, { customerId: customer._id }))
      .sort({ createdAt: -1 })
      .lean(),
    CustomerPayment.find(tenantFilter(req, { customerId: customer._id }))
      .sort({ paidAt: -1 })
      .lean()
  ]);

  const totals = {
    totalSalesAmount: sales.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0),
    totalDebt: Number(customer.totalDebt || 0),
    totalPaid: Number(customer.totalPaid || 0)
  };

  res.json({ customer, sales, payments, totals });
});

router.post("/", authMiddleware, requireAdmin, async (req, res) => {
  const fullName = String(req.body?.fullName || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const address = String(req.body?.address || "").trim();
  const openingBalanceCurrency = String(req.body?.openingBalanceCurrency || "uzs").trim().toLowerCase();

  if (!fullName || !phone || !address) {
    return res.status(400).json({ message: "Ism-familya, telefon va manzil kerak" });
  }
  if (!["uzs", "usd"].includes(openingBalanceCurrency)) {
    return res.status(400).json({ message: "Valyuta noto'g'ri" });
  }

  const exists = await Customer.exists(tenantFilter(req, { phone: { $regex: `^${escapeRegex(phone)}$`, $options: "i" } }));
  if (exists) return res.status(409).json({ message: "Bu telefon bilan mijoz mavjud" });

  const usdRate = await getUsdRate(req.user.tenantId);
  const openingBalance = convertToUzs(req.body?.openingBalanceAmount || 0, openingBalanceCurrency, usdRate);
  if (Number.isNaN(openingBalance)) {
    return res.status(400).json({ message: "Boshlang'ich qarz summasi noto'g'ri" });
  }

  const customer = await Customer.create(withTenant(req, {
    fullName,
    phone,
    address,
    totalDebt: openingBalance,
    totalPaid: 0
  }));

  if (openingBalance > 0) {
    await Sale.create(withTenant(req, {
      cashierId: req.user.id,
      cashierUsername: req.user.username,
      entryType: "opening_balance",
      items: [],
      totalAmount: openingBalance,
      paymentType: "debt",
      payments: { cash: 0, card: 0, click: 0 },
      note: "Boshlang'ich qarzdorlik",
      customerId: customer._id,
      customerName: customer.fullName,
      customerPhone: customer.phone,
      customerAddress: customer.address,
      debtAmount: openingBalance
    }));
  }

  res.status(201).json({ customer });
});

router.put("/:id", authMiddleware, requireAdmin, async (req, res) => {
  const customer = await Customer.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!customer) return res.status(404).json({ message: "Mijoz topilmadi" });

  const fullName = String(req.body?.fullName || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const address = String(req.body?.address || "").trim();
  const openingBalanceCurrency = String(req.body?.openingBalanceCurrency || "uzs").trim().toLowerCase();

  if (!fullName || !phone || !address) {
    return res.status(400).json({ message: "Ism-familya, telefon va manzil kerak" });
  }
  if (!["uzs", "usd"].includes(openingBalanceCurrency)) {
    return res.status(400).json({ message: "Valyuta noto'g'ri" });
  }

  const duplicate = await Customer.exists(tenantFilter(req, {
    _id: { $ne: req.params.id },
    phone: { $regex: `^${escapeRegex(phone)}$`, $options: "i" }
  }));
  if (duplicate) return res.status(409).json({ message: "Bu telefon bilan mijoz mavjud" });

  const usdRate = await getUsdRate(req.user.tenantId);
  const openingBalance = convertToUzs(req.body?.openingBalanceAmount || 0, openingBalanceCurrency, usdRate);
  if (Number.isNaN(openingBalance)) {
    return res.status(400).json({ message: "Boshlang'ich qarz summasi noto'g'ri" });
  }

  customer.fullName = fullName;
  customer.phone = phone;
  customer.address = address;
  customer.totalDebt = roundMoney(Number(customer.totalDebt || 0) + openingBalance);
  await customer.save();

  if (openingBalance > 0) {
    await Sale.create(withTenant(req, {
      cashierId: req.user.id,
      cashierUsername: req.user.username,
      entryType: "opening_balance",
      items: [],
      totalAmount: openingBalance,
      paymentType: "debt",
      payments: { cash: 0, card: 0, click: 0 },
      note: "Boshlang'ich qarzdorlik qo'shildi",
      customerId: customer._id,
      customerName: customer.fullName,
      customerPhone: customer.phone,
      customerAddress: customer.address,
      debtAmount: openingBalance
    }));
  }

  res.json({ customer });
});

router.post("/:id/payments", authMiddleware, requireAdmin, async (req, res) => {
  const customer = await Customer.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!customer) return res.status(404).json({ message: "Mijoz topilmadi" });

  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || "").trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "To'lov summasi 0 dan katta bo'lishi kerak" });
  }
  if (Number(customer.totalDebt || 0) <= 0) {
    return res.status(400).json({ message: "Mijozda ochiq qarz yo'q" });
  }

  const openSales = await Sale.find({
    tenantId: req.user.tenantId,
    customerId: customer._id,
    debtAmount: { $gt: 0 }
  }).sort({ createdAt: 1, _id: 1 });

  if (openSales.length < 1) {
    customer.totalDebt = 0;
    await customer.save();
    return res.status(400).json({ message: "Qarz topilmadi, ma'lumot yangilandi" });
  }

  const totalDebtBefore = openSales.reduce((sum, s) => sum + Number(s.debtAmount || 0), 0);
  const payable = Math.min(amount, totalDebtBefore);
  let remaining = payable;
  const allocations = [];

  for (const sale of openSales) {
    if (remaining <= 0) break;
    const debt = Number(sale.debtAmount || 0);
    if (debt <= 0) continue;

    const applied = Math.min(remaining, debt);
    sale.debtAmount = roundMoney(debt - applied);
    sale.payments = sale.payments || { cash: 0, card: 0, click: 0 };
    sale.payments.cash = roundMoney(Number(sale.payments.cash || 0) + applied);
    await sale.save();

    allocations.push({
      saleId: sale._id,
      appliedAmount: roundMoney(applied)
    });

    remaining = roundMoney(remaining - applied);
  }

  customer.totalDebt = roundMoney(Math.max(0, Number(customer.totalDebt || 0) - payable));
  customer.totalPaid = roundMoney(Number(customer.totalPaid || 0) + payable);
  await customer.save();

  const payment = await CustomerPayment.create(withTenant(req, {
    customerId: customer._id,
    amount: payable,
    note,
    cashierId: req.user.id,
    cashierUsername: req.user.username,
    allocations
  }));

  res.status(201).json({
    payment,
    paidAmount: payable,
    totalDebtBefore,
    totalDebtAfter: customer.totalDebt
  });
});

router.delete("/:id", authMiddleware, requireAdmin, async (req, res) => {
  const customer = await Customer.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!customer) return res.status(404).json({ message: "Mijoz topilmadi" });

  if (Number(customer.totalDebt || 0) > 0) {
    return res.status(400).json({ message: "Mijozning qarzi bor. Avval qarzni yoping." });
  }

  const hasSales = await Sale.exists(tenantFilter(req, { customerId: customer._id }));
  if (hasSales) {
    return res.status(400).json({
      message: "Bu mijozga bog'langan savdo tarixi bor. O'chirib bo'lmaydi."
    });
  }

  await CustomerPayment.deleteMany(tenantFilter(req, { customerId: customer._id }));
  await Customer.deleteOne({ _id: customer._id });

  res.json({ ok: true });
});

export default router;
