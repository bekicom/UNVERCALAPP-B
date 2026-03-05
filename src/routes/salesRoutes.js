import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Customer } from "../models/Customer.js";
import { CustomerPayment } from "../models/CustomerPayment.js";
import { Product } from "../models/Product.js";
import { Sale } from "../models/Sale.js";

const router = Router();
const PAYMENT_TYPES = ["cash", "card", "click", "mixed", "debt"];

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const merged = new Map();

  for (const it of rawItems) {
    const productId = String(it?.productId || "").trim();
    const quantity = Number(it?.quantity);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
    merged.set(productId, roundMoney((merged.get(productId) || 0) + quantity));
  }

  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function normalizePayments(raw) {
  return {
    cash: roundMoney(Math.max(0, Number(raw?.cash) || 0)),
    card: roundMoney(Math.max(0, Number(raw?.card) || 0)),
    click: roundMoney(Math.max(0, Number(raw?.click) || 0))
  };
}

function sumPayments(payments) {
  return roundMoney(Number(payments?.cash || 0) + Number(payments?.card || 0) + Number(payments?.click || 0));
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function allocateByAvailability(total, available) {
  const cash = Math.max(0, Number(available?.cash || 0));
  const card = Math.max(0, Number(available?.card || 0));
  const click = Math.max(0, Number(available?.click || 0));
  const sources = [
    { key: "cash", value: cash },
    { key: "card", value: card },
    { key: "click", value: click }
  ].filter((s) => s.value > 0);

  if (sources.length < 1) return { cash: 0, card: 0, click: 0 };

  const totalAvailable = sources.reduce((sum, s) => sum + s.value, 0);
  let rest = roundMoney(total);
  const out = { cash: 0, card: 0, click: 0 };

  for (let i = 0; i < sources.length; i += 1) {
    const s = sources[i];
    const piece = i === sources.length - 1
      ? rest
      : Math.min(roundMoney((s.value / totalAvailable) * total), rest);
    out[s.key] = roundMoney(piece);
    rest = roundMoney(rest - out[s.key]);
  }

  if (rest > 0) {
    const last = sources[sources.length - 1].key;
    out[last] = roundMoney(out[last] + rest);
  }
  return out;
}

function buildDateRangeQuery({ period, from, to }) {
  const query = {};
  const now = new Date();

  if (period === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    query.$gte = start;
    query.$lt = end;
  } else if (period === "yesterday") {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    query.$gte = start;
    query.$lt = end;
  } else if (period === "7d") {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    query.$gte = start;
  } else if (period === "30d") {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    query.$gte = start;
  } else if (from || to) {
    if (from) {
      const start = new Date(from);
      if (!Number.isNaN(start.getTime())) query.$gte = start;
    }
    if (to) {
      const end = new Date(to);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        query.$lte = end;
      }
    }
  }

  if (!query.$gte && !query.$lte && !query.$lt) return null;
  return query;
}

router.get("/", authMiddleware, async (req, res) => {
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), 300)
    : 100;

  const period = String(req.query?.period || "").toLowerCase();
  const from = String(req.query?.from || "");
  const to = String(req.query?.to || "");
  const query = {};
  const createdAtRange = buildDateRangeQuery({ period, from, to });
  if (createdAtRange) {
    query.createdAt = createdAtRange;
  }

  const paymentQuery = {};
  if (createdAtRange) {
    paymentQuery.paidAt = createdAtRange;
  }

  const [saleDocs, paymentDocs] = await Promise.all([
    Sale.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    CustomerPayment.find(paymentQuery)
      .populate("customerId", "fullName phone")
      .sort({ paidAt: -1 })
      .limit(limit)
      .lean()
  ]);

  const saleEntries = saleDocs.map((sale) => ({
    ...sale,
    transactionType: "sale"
  }));

  const paymentEntries = paymentDocs.map((payment) => ({
    _id: `payment-${String(payment._id)}`,
    transactionType: "debt_payment",
    createdAt: payment.paidAt || payment.createdAt,
    cashierUsername: payment.cashierUsername || "-",
    paymentType: "debt_payment",
    payments: {
      cash: roundMoney(Number(payment.amount || 0)),
      card: 0,
      click: 0
    },
    totalAmount: roundMoney(Number(payment.amount || 0)),
    debtAmount: 0,
    returnedAmount: 0,
    customerId: payment.customerId?._id || null,
    customerName: payment.customerId?.fullName || "",
    customerPhone: payment.customerId?.phone || "",
    note: payment.note || "",
    items: []
  }));

  const sales = [...saleEntries, ...paymentEntries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  const summary = sales.reduce((acc, sale) => {
    const txType = String(sale.transactionType || "sale");
    const total = Number(sale.totalAmount || 0);
    const cash = Number(sale.payments?.cash || 0);
    const card = Number(sale.payments?.card || 0);
    const click = Number(sale.payments?.click || 0);
    const profit = txType === "debt_payment"
      ? 0
      : (sale.items || []).reduce(
        (s, it) => s + (Number(it.lineProfit || 0) - Number(it.returnedProfit || 0)),
        0
      );
    const expense = txType === "debt_payment"
      ? 0
      : Math.max(0, total - profit);
    return {
      totalTransactions: acc.totalTransactions + 1,
      totalSales: acc.totalSales + (txType === "debt_payment" ? 0 : 1),
      totalDebtPaymentCount: acc.totalDebtPaymentCount + (txType === "debt_payment" ? 1 : 0),
      totalRevenue: roundMoney(acc.totalRevenue + (txType === "debt_payment" ? 0 : total)),
      totalDebtPayment: roundMoney(acc.totalDebtPayment + (txType === "debt_payment" ? total : 0)),
      totalCollection: roundMoney(acc.totalCollection + cash + card + click),
      totalCash: roundMoney(acc.totalCash + cash),
      totalCard: roundMoney(acc.totalCard + card),
      totalClick: roundMoney(acc.totalClick + click),
      totalProfit: roundMoney(acc.totalProfit + profit),
      totalExpense: roundMoney(acc.totalExpense + expense)
    };
  }, {
    totalTransactions: 0,
    totalSales: 0,
    totalDebtPaymentCount: 0,
    totalRevenue: 0,
    totalDebtPayment: 0,
    totalCollection: 0,
    totalCash: 0,
    totalCard: 0,
    totalClick: 0,
    totalProfit: 0,
    totalExpense: 0
  });

  return res.json({ sales, summary });
});

router.get("/returns", authMiddleware, async (req, res) => {
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), 500)
    : 200;

  const period = String(req.query?.period || "").toLowerCase();
  const from = String(req.query?.from || "");
  const to = String(req.query?.to || "");
  const returnCreatedAtRange = buildDateRangeQuery({ period, from, to });

  const pipeline = [
    { $match: { returns: { $exists: true, $ne: [] } } },
    { $unwind: "$returns" }
  ];

  if (returnCreatedAtRange) {
    pipeline.push({ $match: { "returns.createdAt": returnCreatedAtRange } });
  }

  pipeline.push(
    {
      $project: {
        _id: "$returns._id",
        saleId: "$_id",
        saleCreatedAt: "$createdAt",
        returnCreatedAt: "$returns.createdAt",
        cashierUsername: "$returns.cashierUsername",
        paymentType: "$returns.paymentType",
        payments: "$returns.payments",
        totalAmount: "$returns.totalAmount",
        note: "$returns.note",
        items: "$returns.items"
      }
    },
    { $sort: { returnCreatedAt: -1 } },
    { $limit: limit }
  );

  const returns = await Sale.aggregate(pipeline);

  const summary = returns.reduce((acc, ret) => {
    const qty = (ret.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
    return {
      totalReturns: acc.totalReturns + 1,
      totalReturnedAmount: roundMoney(acc.totalReturnedAmount + Number(ret.totalAmount || 0)),
      totalReturnedCash: roundMoney(acc.totalReturnedCash + Number(ret.payments?.cash || 0)),
      totalReturnedCard: roundMoney(acc.totalReturnedCard + Number(ret.payments?.card || 0)),
      totalReturnedClick: roundMoney(acc.totalReturnedClick + Number(ret.payments?.click || 0)),
      totalReturnedQty: roundMoney(acc.totalReturnedQty + qty)
    };
  }, {
    totalReturns: 0,
    totalReturnedAmount: 0,
    totalReturnedCash: 0,
    totalReturnedCard: 0,
    totalReturnedClick: 0,
    totalReturnedQty: 0
  });

  return res.json({ returns, summary });
});

router.post("/", authMiddleware, async (req, res) => {
  const items = normalizeItems(req.body?.items);
  const paymentType = String(req.body?.paymentType || "").trim().toLowerCase();
  const note = String(req.body?.note || "").trim();
  const customerInput = {
    fullName: String(req.body?.customer?.fullName || "").trim(),
    phone: String(req.body?.customer?.phone || "").trim(),
    address: String(req.body?.customer?.address || "").trim()
  };

  if (items.length < 1) {
    return res.status(400).json({ message: "Sotuv uchun kamida 1 ta mahsulot kerak" });
  }
  if (!PAYMENT_TYPES.includes(paymentType)) {
    return res.status(400).json({ message: "To'lov turi noto'g'ri" });
  }

  const productIds = items.map((it) => it.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id name model unit quantity retailPrice purchasePrice")
    .lean();

  if (products.length !== items.length) {
    return res.status(400).json({ message: "Ba'zi mahsulotlar topilmadi" });
  }

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const saleItems = [];

  for (const reqItem of items) {
    const product = productMap.get(reqItem.productId);
    if (!product) {
      return res.status(400).json({ message: "Mahsulot topilmadi" });
    }

    const currentQty = Number(product.quantity) || 0;
    if (reqItem.quantity > currentQty) {
      return res.status(409).json({
        message: `${product.name} uchun qoldiq yetarli emas (${currentQty})`
      });
    }

    const unitPrice = Number(product.retailPrice) || 0;
    const costPrice = Number(product.purchasePrice) || 0;
    const lineTotal = roundMoney(unitPrice * reqItem.quantity);
    const lineProfit = roundMoney((unitPrice - costPrice) * reqItem.quantity);
    saleItems.push({
      productId: product._id,
      productName: product.name,
      productModel: product.model || "",
      unit: product.unit,
      quantity: reqItem.quantity,
      unitPrice,
      lineTotal,
      costPrice,
      lineProfit
    });
  }

  const totalAmount = roundMoney(saleItems.reduce((sum, it) => sum + it.lineTotal, 0));
  const payments = normalizePayments(req.body?.payments);
  let customer = null;

  if (paymentType === "cash") {
    payments.cash = totalAmount;
    payments.card = 0;
    payments.click = 0;
  } else if (paymentType === "card") {
    payments.cash = 0;
    payments.card = totalAmount;
    payments.click = 0;
  } else if (paymentType === "click") {
    payments.cash = 0;
    payments.card = 0;
    payments.click = totalAmount;
  } else if (paymentType === "debt") {
    if (!customerInput.fullName || !customerInput.phone || !customerInput.address) {
      return res.status(400).json({ message: "Qarzga sotuv uchun mijoz ismi, telefoni va manzili kerak" });
    }

    customer = await Customer.findOne({ phone: customerInput.phone });
    if (!customer) {
      customer = await Customer.create({
        fullName: customerInput.fullName,
        phone: customerInput.phone,
        address: customerInput.address,
        totalDebt: 0,
        totalPaid: 0
      });
    } else {
      customer.fullName = customerInput.fullName;
      customer.address = customerInput.address;
      await customer.save();
    }

    payments.cash = 0;
    payments.card = 0;
    payments.click = 0;
  } else {
    const sum = roundMoney(payments.cash + payments.card + payments.click);
    if (Math.abs(sum - totalAmount) > 0.01) {
      return res.status(400).json({ message: "Aralash to'lov summasi jami summaga teng bo'lishi kerak" });
    }
  }

  const applied = [];
  for (const item of saleItems) {
    const updated = await Product.updateOne(
      { _id: item.productId, quantity: { $gte: item.quantity } },
      { $inc: { quantity: -item.quantity } }
    );

    if (updated.modifiedCount !== 1) {
      for (const rollback of applied) {
        await Product.updateOne({ _id: rollback.productId }, { $inc: { quantity: rollback.quantity } });
      }
      return res.status(409).json({ message: `${item.productName} qoldig'i yetarli emas` });
    }
    applied.push({ productId: item.productId, quantity: item.quantity });
  }

  const sale = await Sale.create({
    cashierId: req.user.id,
    cashierUsername: req.user.username,
    items: saleItems,
    totalAmount,
    paymentType,
    payments,
    note,
    customerId: customer?._id || null,
    customerName: customer?.fullName || "",
    customerPhone: customer?.phone || "",
    customerAddress: customer?.address || "",
    debtAmount: paymentType === "debt" ? totalAmount : 0
  });

  if (customer) {
    customer.totalDebt = roundMoney(Number(customer.totalDebt || 0) + totalAmount);
    await customer.save();
  }

  return res.status(201).json({ sale });
});

router.post("/:id/returns", authMiddleware, async (req, res) => {
  const sale = await Sale.findById(req.params.id);
  if (!sale) return res.status(404).json({ message: "Sotuv topilmadi" });

  const items = normalizeItems(req.body?.items);
  if (items.length < 1) {
    return res.status(400).json({ message: "Vozvrat uchun kamida 1 ta mahsulot kerak" });
  }

  const note = String(req.body?.note || "").trim();
  const requestedType = String(req.body?.paymentType || "").trim().toLowerCase();
  const fallbackType = sale.paymentType === "mixed" ? "mixed" : sale.paymentType;
  const paymentType = PAYMENT_TYPES.includes(requestedType) ? requestedType : fallbackType;

  const returnItems = [];
  for (const item of items) {
    const saleItem = sale.items.find((it) => String(it.productId) === item.productId);
    if (!saleItem) {
      return res.status(400).json({ message: "Bu mahsulot ushbu sotuvda topilmadi" });
    }

    const soldQty = Number(saleItem.quantity || 0);
    const returnedQty = Number(saleItem.returnedQuantity || 0);
    const leftQty = roundMoney(soldQty - returnedQty);
    if (!isPositiveNumber(item.quantity) || item.quantity > leftQty) {
      return res.status(400).json({
        message: `${saleItem.productName} uchun maksimal vozvrat: ${leftQty}`
      });
    }

    const unitPrice = Number(saleItem.unitPrice || 0);
    const costPrice = Number(saleItem.costPrice || 0);
    const lineTotal = roundMoney(unitPrice * item.quantity);
    const lineProfit = roundMoney((unitPrice - costPrice) * item.quantity);

    returnItems.push({
      productId: saleItem.productId,
      productName: saleItem.productName,
      unit: saleItem.unit,
      quantity: roundMoney(item.quantity),
      unitPrice,
      lineTotal,
      lineProfit
    });
  }

  const returnTotal = roundMoney(returnItems.reduce((sum, it) => sum + Number(it.lineTotal || 0), 0));
  if (!isPositiveNumber(returnTotal)) {
    return res.status(400).json({ message: "Vozvrat summasi noto'g'ri" });
  }
  if (returnTotal - Number(sale.totalAmount || 0) > 0.01) {
    return res.status(400).json({ message: "Vozvrat summasi sotuv qoldig'idan katta" });
  }

  const availablePayments = normalizePayments(sale.payments);
  let refundPayments = { cash: 0, card: 0, click: 0 };

  if (paymentType === "debt") {
    if (!sale.customerId) {
      return res.status(400).json({ message: "Bu sotuvda qarzdor mijoz bog'lanmagan" });
    }
    if (returnTotal - Number(sale.debtAmount || 0) > 0.01) {
      return res.status(400).json({ message: "Qaytim summasi ochiq qarzdan katta bo'lmasligi kerak" });
    }
  } else if (paymentType === "mixed") {
    const inputPayments = normalizePayments(req.body?.payments);
    refundPayments = sumPayments(inputPayments) > 0
      ? inputPayments
      : allocateByAvailability(returnTotal, availablePayments);

    const mixedSum = sumPayments(refundPayments);
    if (Math.abs(mixedSum - returnTotal) > 0.01) {
      return res.status(400).json({ message: "Aralash vozvratda summalar jami qaytimga teng bo'lishi kerak" });
    }
  } else if (paymentType === "cash") {
    refundPayments = { cash: returnTotal, card: 0, click: 0 };
  } else if (paymentType === "card") {
    refundPayments = { cash: 0, card: returnTotal, click: 0 };
  } else if (paymentType === "click") {
    refundPayments = { cash: 0, card: 0, click: returnTotal };
  }

  if (paymentType !== "debt") {
    if (refundPayments.cash - availablePayments.cash > 0.01
      || refundPayments.card - availablePayments.card > 0.01
      || refundPayments.click - availablePayments.click > 0.01) {
      return res.status(400).json({ message: "Tanlangan to'lov turida qaytarish uchun yetarli summa yo'q" });
    }
  }

  const updatedStock = [];
  for (const item of returnItems) {
    const changed = await Product.updateOne(
      { _id: item.productId },
      { $inc: { quantity: item.quantity } }
    );
    if (changed.matchedCount !== 1) {
      for (const rollback of updatedStock) {
        await Product.updateOne({ _id: rollback.productId }, { $inc: { quantity: -rollback.quantity } });
      }
      return res.status(409).json({ message: `${item.productName} omborda topilmadi` });
    }
    updatedStock.push({ productId: item.productId, quantity: item.quantity });
  }

  for (const item of returnItems) {
    const target = sale.items.find((it) => String(it.productId) === String(item.productId));
    if (!target) continue;
    target.returnedQuantity = roundMoney(Number(target.returnedQuantity || 0) + item.quantity);
    target.returnedTotal = roundMoney(Number(target.returnedTotal || 0) + item.lineTotal);
    target.returnedProfit = roundMoney(Number(target.returnedProfit || 0) + item.lineProfit);
  }

  sale.totalAmount = roundMoney(Math.max(0, Number(sale.totalAmount || 0) - returnTotal));
  sale.payments.cash = roundMoney(Math.max(0, Number(sale.payments?.cash || 0) - refundPayments.cash));
  sale.payments.card = roundMoney(Math.max(0, Number(sale.payments?.card || 0) - refundPayments.card));
  sale.payments.click = roundMoney(Math.max(0, Number(sale.payments?.click || 0) - refundPayments.click));

  if (sale.customerId) {
    const customer = await Customer.findById(sale.customerId);
    if (customer) {
      if (paymentType === "debt") {
        customer.totalDebt = roundMoney(Math.max(0, Number(customer.totalDebt || 0) - returnTotal));
      } else {
        const refundedPaid = sumPayments(refundPayments);
        customer.totalPaid = roundMoney(Math.max(0, Number(customer.totalPaid || 0) - refundedPaid));
      }
      await customer.save();
    }
  }

  if (paymentType === "debt") {
    sale.debtAmount = roundMoney(Math.max(0, Number(sale.debtAmount || 0) - returnTotal));
  }

  sale.returnedAmount = roundMoney(Number(sale.returnedAmount || 0) + returnTotal);
  sale.returnedPayments.cash = roundMoney(Number(sale.returnedPayments?.cash || 0) + refundPayments.cash);
  sale.returnedPayments.card = roundMoney(Number(sale.returnedPayments?.card || 0) + refundPayments.card);
  sale.returnedPayments.click = roundMoney(Number(sale.returnedPayments?.click || 0) + refundPayments.click);

  sale.returns.push({
    cashierId: req.user.id,
    cashierUsername: req.user.username,
    paymentType,
    payments: refundPayments,
    totalAmount: returnTotal,
    note,
    items: returnItems
  });

  await sale.save();
  return res.json({ sale });
});

export default router;
