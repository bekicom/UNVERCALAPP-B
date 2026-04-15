<<<<<<< HEAD
import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Customer } from "../models/Customer.js";
import { CustomerPayment } from "../models/CustomerPayment.js";
import { Master } from "../models/Master.js";
import { Product } from "../models/Product.js";
import { Sale } from "../models/Sale.js";
import { Shift } from "../models/Shift.js";
import { tenantFilter, withTenant } from "../tenant.js";

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
    const priceType = String(it?.priceType || "retail").trim().toLowerCase();
    const unitPrice = Number(it?.unitPrice);
    const variantSize = String(it?.variantSize || "").trim();
    const variantColor = String(it?.variantColor || "").trim();
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
    const normalizedPriceType = priceType === "wholesale" ? "wholesale" : "retail";
    const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? roundMoney(unitPrice) : null;
    const key = `${productId}:${normalizedPriceType}:${safeUnitPrice ?? "auto"}:${variantSize}:${variantColor}`;
    const prev = merged.get(key) || {
      productId,
      quantity: 0,
      priceType: normalizedPriceType,
      unitPrice: safeUnitPrice,
      variantSize,
      variantColor
    };
    merged.set(key, {
      productId,
      priceType: normalizedPriceType,
      unitPrice: safeUnitPrice,
      variantSize,
      variantColor,
      quantity: roundMoney(prev.quantity + quantity)
    });
  }

  return [...merged.values()];
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

function normalizePlate(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

async function resolveMasterSale(req, rawMaster = {}) {
  const fullName = String(rawMaster?.fullName || "").trim();
  const phone = String(rawMaster?.phone || "").trim();
  const vehiclePlate = normalizePlate(rawMaster?.vehiclePlate);
  const vehicleModel = String(rawMaster?.vehicleModel || "").trim();
  const masterId = String(rawMaster?.id || "").trim();
  const vehicleId = String(rawMaster?.vehicleId || "").trim();

  if (!fullName || !vehiclePlate) {
    return { error: "Usta ismi va mashina raqami kerak" };
  }

  let master = null;
  if (masterId) {
    master = await Master.findOne(tenantFilter(req, { _id: masterId }));
  }

  if (!master) {
    master = await Master.findOne(tenantFilter(req, {
      $or: [
        { "vehicles.plateNumber": vehiclePlate },
        { fullName, phone }
      ]
    }));
  }

  if (!master) {
    master = await Master.create(withTenant(req, {
      fullName,
      phone,
      vehicles: [{
        plateNumber: vehiclePlate,
        model: vehicleModel
      }]
    }));
  } else {
    if (phone && !master.phone) {
      master.phone = phone;
    }
    if (fullName && master.fullName !== fullName) {
      master.fullName = fullName;
    }
  }

  let vehicle = null;
  if (vehicleId) {
    vehicle = master.vehicles.id(vehicleId);
  }
  if (!vehicle) {
    vehicle = master.vehicles.find((entry) => normalizePlate(entry.plateNumber) === vehiclePlate) || null;
  }
  if (!vehicle) {
    master.vehicles.push({
      plateNumber: vehiclePlate,
      model: vehicleModel
    });
    vehicle = master.vehicles[master.vehicles.length - 1];
  } else if (vehicleModel && !String(vehicle.model || "").trim()) {
    vehicle.model = vehicleModel;
  }

  await master.save();
  return {
    master,
    vehicle
  };
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

router.get("/variant-insights", authMiddleware, async (req, res) => {
  const period = String(req.query?.period || "").toLowerCase();
  const from = String(req.query?.from || "");
  const to = String(req.query?.to || "");
  const cashierUsername = String(req.query?.cashierUsername || "").trim();
  const shiftId = String(req.query?.shiftId || "").trim();
  const size = String(req.query?.size || "").trim();
  const color = String(req.query?.color || "").trim();

  const match = tenantFilter(req, { entryType: { $ne: "opening_balance" } });
  const createdAtRange = buildDateRangeQuery({ period, from, to });
  if (createdAtRange) {
    match.createdAt = createdAtRange;
  }
  if (cashierUsername) {
    match.cashierUsername = cashierUsername;
  }
  if (shiftId) {
    match.shiftId = shiftId;
  }

  const pipeline = [
    { $match: match },
    { $unwind: "$items" },
    {
      $match: {
        $or: [
          { "items.variantSize": { $exists: true, $ne: "" } },
          { "items.variantColor": { $exists: true, $ne: "" } }
        ]
      }
    }
  ];

  if (size) {
    pipeline.push({ $match: { "items.variantSize": size } });
  }
  if (color) {
    pipeline.push({ $match: { "items.variantColor": color } });
  }

  pipeline.push(
    {
      $group: {
        _id: {
          productId: "$items.productId",
          productName: "$items.productName",
          size: "$items.variantSize",
          color: "$items.variantColor"
        },
        quantity: { $sum: { $subtract: ["$items.quantity", "$items.returnedQuantity"] } },
        revenue: {
          $sum: {
            $subtract: ["$items.lineTotal", "$items.returnedTotal"]
          }
        }
      }
    },
    {
      $project: {
        _id: 0,
        productId: "$_id.productId",
        productName: "$_id.productName",
        size: "$_id.size",
        color: "$_id.color",
        quantity: { $round: ["$quantity", 2] },
        revenue: { $round: ["$revenue", 2] }
      }
    },
    { $sort: { quantity: -1, revenue: -1, productName: 1 } }
  );

  const rows = await Sale.aggregate(pipeline);
  const positiveRows = rows.filter(
    (row) => Number(row.quantity || 0) > 0.0001 || Number(row.revenue || 0) > 0.0001
  );
  const availableSizes = [...new Set(positiveRows.map((row) => String(row.size || "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
  const availableColors = [...new Set(positiveRows.map((row) => String(row.color || "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  const byProduct = new Map();
  const bySize = new Map();
  const byColor = new Map();
  let totalQuantity = 0;
  let totalRevenue = 0;

  for (const row of positiveRows) {
    const qty = Number(row.quantity || 0);
    const revenue = Number(row.revenue || 0);
    totalQuantity += qty;
    totalRevenue += revenue;

    const productName = String(row.productName || "").trim() || "-";
    byProduct.set(productName, roundMoney((byProduct.get(productName) || 0) + qty));

    const sizeKey = String(row.size || "").trim();
    if (sizeKey) {
      bySize.set(sizeKey, roundMoney((bySize.get(sizeKey) || 0) + qty));
    }

    const colorKey = String(row.color || "").trim();
    if (colorKey) {
      byColor.set(colorKey, roundMoney((byColor.get(colorKey) || 0) + qty));
    }
  }

  function topLabel(map) {
    let bestLabel = "";
    let bestValue = 0;
    for (const [label, value] of map.entries()) {
      if (Number(value) > bestValue) {
        bestLabel = label;
        bestValue = Number(value);
      }
    }
    return { label: bestLabel, quantity: roundMoney(bestValue) };
  }

  return res.json({
    summary: {
      totalQuantity: roundMoney(totalQuantity),
      totalRevenue: roundMoney(totalRevenue),
      topProduct: topLabel(byProduct),
      topSize: topLabel(bySize),
      topColor: topLabel(byColor)
    },
    availableSizes,
    availableColors,
    rows: positiveRows.slice(0, 50)
  });
});

router.get("/", authMiddleware, async (req, res) => {
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), 300)
    : 100;

  const period = String(req.query?.period || "").toLowerCase();
  const from = String(req.query?.from || "");
  const to = String(req.query?.to || "");
  const cashierUsername = String(req.query?.cashierUsername || "").trim();
  const shiftId = String(req.query?.shiftId || "").trim();
  const query = tenantFilter(req, { entryType: { $ne: "opening_balance" } });
  const createdAtRange = buildDateRangeQuery({ period, from, to });
  if (createdAtRange) {
    query.createdAt = createdAtRange;
  }
  if (cashierUsername) {
    query.cashierUsername = cashierUsername;
  }
  if (shiftId) {
    query.shiftId = shiftId;
  }

  const paymentQuery = tenantFilter(req);
  if (createdAtRange) {
    paymentQuery.paidAt = createdAtRange;
  }
  if (cashierUsername) {
    paymentQuery.cashierUsername = cashierUsername;
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

  const paymentEntries = shiftId
    ? []
    : paymentDocs.map((payment) => ({
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
    { $match: tenantFilter(req, { returns: { $exists: true, $ne: [] } }) },
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
  const masterInput = req.body?.master || null;
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

  const productIds = [...new Set(items.map((it) => it.productId))];
  const products = await Product.find(tenantFilter(req, { _id: { $in: productIds } }))
    .select("_id name model barcode unit quantity variantStocks retailPrice wholesalePrice purchasePrice")
    .populate({ path: "categoryId", select: "name" })
    .lean();

  if (products.length !== productIds.length) {
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
    let currentVariantQty = currentQty;
    let variantSize = "";
    let variantColor = "";

    if (Array.isArray(product.variantStocks) && product.variantStocks.length > 0) {
      variantSize = String(reqItem.variantSize || "").trim();
      variantColor = String(reqItem.variantColor || "").trim();
      if (!variantSize || !variantColor) {
        return res.status(400).json({ message: `${product.name} uchun variant tanlang` });
      }
      const variant = product.variantStocks.find(
        (it) => String(it?.size || "").trim() === variantSize && String(it?.color || "").trim() === variantColor
      );
      if (!variant) {
        return res.status(409).json({ message: `${product.name} uchun tanlangan variant topilmadi` });
      }
      currentVariantQty = Number(variant.quantity) || 0;
    }

    const safeAvailableQty =
      Array.isArray(product.variantStocks) && product.variantStocks.length > 0
        ? currentVariantQty
        : currentQty;
    if (reqItem.quantity > safeAvailableQty) {
      return res.status(409).json({
        message: `${product.name} uchun qoldiq yetarli emas (${safeAvailableQty})`
      });
    }

    const defaultUnitPrice = reqItem.priceType === "wholesale"
      ? Number(product.wholesalePrice || 0)
      : Number(product.retailPrice || 0);
    const unitPrice = Number.isFinite(reqItem.unitPrice) && reqItem.unitPrice >= 0
      ? Number(reqItem.unitPrice)
      : defaultUnitPrice;
    const costPrice = Number(product.purchasePrice) || 0;
    const lineTotal = roundMoney(unitPrice * reqItem.quantity);
    const lineProfit = roundMoney((unitPrice - costPrice) * reqItem.quantity);
    saleItems.push({
      productId: product._id,
      productName: product.name,
      productModel: product.model || "",
      categoryName: product.categoryId?.name || "",
      barcode: product.barcode || "",
      unit: product.unit,
      variantSize,
      variantColor,
      priceType: reqItem.priceType === "wholesale" ? "wholesale" : "retail",
      quantity: reqItem.quantity,
      unitPrice,
      lineTotal,
      costPrice,
      lineProfit
    });
  }

=======
import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Customer } from "../models/Customer.js";
import { CustomerPayment } from "../models/CustomerPayment.js";
import { Master } from "../models/Master.js";
import { Product } from "../models/Product.js";
import { Sale } from "../models/Sale.js";
import { tenantFilter, withTenant } from "../tenant.js";

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
    const priceType = String(it?.priceType || "retail").trim().toLowerCase();
    const unitPrice = Number(it?.unitPrice);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
    const normalizedPriceType = priceType === "wholesale" ? "wholesale" : "retail";
    const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? roundMoney(unitPrice) : null;
    const key = `${productId}:${normalizedPriceType}:${safeUnitPrice ?? "auto"}`;
    const prev = merged.get(key) || { productId, quantity: 0, priceType: normalizedPriceType, unitPrice: safeUnitPrice };
    merged.set(key, {
      productId,
      priceType: normalizedPriceType,
      unitPrice: safeUnitPrice,
      quantity: roundMoney(prev.quantity + quantity)
    });
  }

  return [...merged.values()];
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

function normalizePlate(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

async function resolveMasterSale(req, rawMaster = {}) {
  const fullName = String(rawMaster?.fullName || "").trim();
  const phone = String(rawMaster?.phone || "").trim();
  const vehiclePlate = normalizePlate(rawMaster?.vehiclePlate);
  const vehicleModel = String(rawMaster?.vehicleModel || "").trim();
  const masterId = String(rawMaster?.id || "").trim();
  const vehicleId = String(rawMaster?.vehicleId || "").trim();

  if (!fullName || !vehiclePlate) {
    return { error: "Usta ismi va mashina raqami kerak" };
  }

  let master = null;
  if (masterId) {
    master = await Master.findOne(tenantFilter(req, { _id: masterId }));
  }

  if (!master) {
    master = await Master.findOne(tenantFilter(req, {
      $or: [
        { "vehicles.plateNumber": vehiclePlate },
        { fullName, phone }
      ]
    }));
  }

  if (!master) {
    master = await Master.create(withTenant(req, {
      fullName,
      phone,
      vehicles: [{
        plateNumber: vehiclePlate,
        model: vehicleModel
      }]
    }));
  } else {
    if (phone && !master.phone) {
      master.phone = phone;
    }
    if (fullName && master.fullName !== fullName) {
      master.fullName = fullName;
    }
  }

  let vehicle = null;
  if (vehicleId) {
    vehicle = master.vehicles.id(vehicleId);
  }
  if (!vehicle) {
    vehicle = master.vehicles.find((entry) => normalizePlate(entry.plateNumber) === vehiclePlate) || null;
  }
  if (!vehicle) {
    master.vehicles.push({
      plateNumber: vehiclePlate,
      model: vehicleModel
    });
    vehicle = master.vehicles[master.vehicles.length - 1];
  } else if (vehicleModel && !String(vehicle.model || "").trim()) {
    vehicle.model = vehicleModel;
  }

  await master.save();
  return {
    master,
    vehicle
  };
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
  const query = tenantFilter(req, { entryType: { $ne: "opening_balance" } });
  const createdAtRange = buildDateRangeQuery({ period, from, to });
  if (createdAtRange) {
    query.createdAt = createdAtRange;
  }

  const paymentQuery = tenantFilter(req);
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
    { $match: tenantFilter(req, { returns: { $exists: true, $ne: [] } }) },
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
  const masterInput = req.body?.master || null;
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
  const products = await Product.find(tenantFilter(req, { _id: { $in: productIds } }))
    .select("_id name model unit quantity retailPrice wholesalePrice purchasePrice")
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

    const defaultUnitPrice = reqItem.priceType === "wholesale"
      ? Number(product.wholesalePrice || 0)
      : Number(product.retailPrice || 0);
    const unitPrice = Number.isFinite(reqItem.unitPrice) && reqItem.unitPrice >= 0
      ? Number(reqItem.unitPrice)
      : defaultUnitPrice;
    const costPrice = Number(product.purchasePrice) || 0;
    const lineTotal = roundMoney(unitPrice * reqItem.quantity);
    const lineProfit = roundMoney((unitPrice - costPrice) * reqItem.quantity);
    saleItems.push({
      productId: product._id,
      productName: product.name,
      productModel: product.model || "",
      unit: product.unit,
      priceType: reqItem.priceType === "wholesale" ? "wholesale" : "retail",
      quantity: reqItem.quantity,
      unitPrice,
      lineTotal,
      costPrice,
      lineProfit
    });
  }

>>>>>>> b87c25050512a2ade573d01e46a21ed576558824
  const totalAmount = roundMoney(saleItems.reduce((sum, it) => sum + it.lineTotal, 0));
  const payments = normalizePayments(req.body?.payments);
  let customer = null;
  let masterSale = null;

  if (masterInput?.fullName || masterInput?.vehiclePlate) {
    masterSale = await resolveMasterSale(req, masterInput);
    if (masterSale?.error) {
      return res.status(400).json({ message: masterSale.error });
    }
  }
<<<<<<< HEAD

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
    if (!masterSale) {
      if (!customerInput.fullName || !customerInput.phone || !customerInput.address) {
        return res.status(400).json({ message: "Qarzga sotuv uchun mijoz ismi, telefoni va manzili kerak" });
      }

      customer = await Customer.findOne(tenantFilter(req, { phone: customerInput.phone }));
      if (!customer) {
        customer = await Customer.create(withTenant(req, {
          fullName: customerInput.fullName,
          phone: customerInput.phone,
          address: customerInput.address,
          totalDebt: 0,
          totalPaid: 0
        }));
      } else {
        customer.fullName = customerInput.fullName;
        customer.address = customerInput.address;
        await customer.save();
      }
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
    const updateQuery = item.variantSize && item.variantColor
      ? tenantFilter(req, {
        _id: item.productId,
        quantity: { $gte: item.quantity },
        variantStocks: {
          $elemMatch: {
            size: item.variantSize,
            color: item.variantColor,
            quantity: { $gte: item.quantity }
          }
        }
      })
      : tenantFilter(req, { _id: item.productId, quantity: { $gte: item.quantity } });
    const updateBody = item.variantSize && item.variantColor
      ? { $inc: { quantity: -item.quantity, "variantStocks.$.quantity": -item.quantity } }
      : { $inc: { quantity: -item.quantity } };
    const updated = await Product.updateOne(updateQuery, updateBody);

    if (updated.modifiedCount !== 1) {
      for (const rollback of applied) {
        if (rollback.variantSize && rollback.variantColor) {
          await Product.updateOne(
            tenantFilter(req, {
              _id: rollback.productId,
              variantStocks: { $elemMatch: { size: rollback.variantSize, color: rollback.variantColor } }
            }),
            { $inc: { quantity: rollback.quantity, "variantStocks.$.quantity": rollback.quantity } }
          );
        } else {
          await Product.updateOne(
            tenantFilter(req, { _id: rollback.productId }),
            { $inc: { quantity: rollback.quantity } }
          );
        }
      }
      return res.status(409).json({ message: `${item.productName} qoldig'i yetarli emas` });
    }
    applied.push({
      productId: item.productId,
      quantity: item.quantity,
      variantSize: item.variantSize || "",
      variantColor: item.variantColor || ""
    });
  }

  const sale = await Sale.create(withTenant(req, {
    cashierId: req.user.id,
    cashierUsername: req.user.username,
    items: saleItems,
    totalAmount,
    paymentType,
    payments,
    note,
=======

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
    if (!masterSale) {
      if (!customerInput.fullName || !customerInput.phone || !customerInput.address) {
        return res.status(400).json({ message: "Qarzga sotuv uchun mijoz ismi, telefoni va manzili kerak" });
      }

      customer = await Customer.findOne(tenantFilter(req, { phone: customerInput.phone }));
      if (!customer) {
        customer = await Customer.create(withTenant(req, {
          fullName: customerInput.fullName,
          phone: customerInput.phone,
          address: customerInput.address,
          totalDebt: 0,
          totalPaid: 0
        }));
      } else {
        customer.fullName = customerInput.fullName;
        customer.address = customerInput.address;
        await customer.save();
      }
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
      tenantFilter(req, { _id: item.productId, quantity: { $gte: item.quantity } }),
      { $inc: { quantity: -item.quantity } }
    );

    if (updated.modifiedCount !== 1) {
      for (const rollback of applied) {
        await Product.updateOne(tenantFilter(req, { _id: rollback.productId }), { $inc: { quantity: rollback.quantity } });
      }
      return res.status(409).json({ message: `${item.productName} qoldig'i yetarli emas` });
    }
    applied.push({ productId: item.productId, quantity: item.quantity });
  }

  const sale = await Sale.create(withTenant(req, {
    cashierId: req.user.id,
    cashierUsername: req.user.username,
    items: saleItems,
    totalAmount,
    paymentType,
    payments,
    note,
>>>>>>> b87c25050512a2ade573d01e46a21ed576558824
    customerId: customer?._id || null,
    customerName: customer?.fullName || "",
    customerPhone: customer?.phone || "",
    customerAddress: customer?.address || "",
    masterId: masterSale?.master?._id || null,
    masterName: masterSale?.master?.fullName || "",
    masterPhone: masterSale?.master?.phone || "",
    vehicleId: masterSale?.vehicle?._id || null,
    vehiclePlate: masterSale?.vehicle?.plateNumber || "",
    vehicleModel: masterSale?.vehicle?.model || "",
    debtAmount: paymentType === "debt" ? totalAmount : 0
  }));
<<<<<<< HEAD

  if (activeShift) {
    const itemCount = saleItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    activeShift.totalSalesCount = Number(activeShift.totalSalesCount || 0) + 1;
    activeShift.totalItemsCount = roundMoney(Number(activeShift.totalItemsCount || 0) + itemCount);
    activeShift.totalAmount = roundMoney(Number(activeShift.totalAmount || 0) + totalAmount);
    activeShift.totalCash = roundMoney(Number(activeShift.totalCash || 0) + Number(payments.cash || 0));
    activeShift.totalCard = roundMoney(Number(activeShift.totalCard || 0) + Number(payments.card || 0));
    activeShift.totalClick = roundMoney(Number(activeShift.totalClick || 0) + Number(payments.click || 0));
    activeShift.totalDebt = roundMoney(Number(activeShift.totalDebt || 0) + Number(paymentType === "debt" ? totalAmount : 0));
    activeShift.lastSaleAt = new Date();
    await activeShift.save();
  }

  if (customer) {
    customer.totalDebt = roundMoney(Number(customer.totalDebt || 0) + totalAmount);
    await customer.save();
  }

  if (masterSale?.master && masterSale?.vehicle) {
    const vehicle = masterSale.master.vehicles.id(masterSale.vehicle._id);
    if (vehicle) {
      if (paymentType === "debt") {
        vehicle.totalDebt = roundMoney(Number(vehicle.totalDebt || 0) + totalAmount);
      }
      vehicle.lastSaleAt = new Date();
      await masterSale.master.save();
    }
  }

  return res.status(201).json({ sale });
});

=======

  if (customer) {
    customer.totalDebt = roundMoney(Number(customer.totalDebt || 0) + totalAmount);
    await customer.save();
  }

  if (masterSale?.master && masterSale?.vehicle) {
    const vehicle = masterSale.master.vehicles.id(masterSale.vehicle._id);
    if (vehicle) {
      if (paymentType === "debt") {
        vehicle.totalDebt = roundMoney(Number(vehicle.totalDebt || 0) + totalAmount);
      }
      vehicle.lastSaleAt = new Date();
      await masterSale.master.save();
    }
  }

  return res.status(201).json({ sale });
});

>>>>>>> b87c25050512a2ade573d01e46a21ed576558824
router.post("/:id/returns", authMiddleware, async (req, res) => {
  const sale = await Sale.findOne(tenantFilter(req, { _id: req.params.id }));
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
    const requestedVariantSize = String(item.variantSize || "").trim();
    const requestedVariantColor = String(item.variantColor || "").trim();
    let matchingSaleItems = sale.items.filter((it) => {
      if (String(it.productId) !== item.productId) return false;
      return String(it.variantSize || "").trim() === requestedVariantSize
        && String(it.variantColor || "").trim() === requestedVariantColor;
    });
    if (matchingSaleItems.length < 1 && (requestedVariantSize || requestedVariantColor)) {
      matchingSaleItems = sale.items.filter((it) => {
        if (String(it.productId) !== item.productId) return false;
        return !String(it.variantSize || "").trim() && !String(it.variantColor || "").trim();
      });
    }
    if (matchingSaleItems.length < 1) {
      return res.status(400).json({ message: "Bu mahsulot ushbu sotuvda topilmadi" });
    }

    const leftQty = roundMoney(
      matchingSaleItems.reduce((sum, saleItem) => {
        const soldQty = Number(saleItem.quantity || 0);
        const returnedQty = Number(saleItem.returnedQuantity || 0);
        return sum + roundMoney(soldQty - returnedQty);
      }, 0)
    );
    if (!isPositiveNumber(item.quantity) || item.quantity > leftQty) {
      const saleItem = matchingSaleItems[0];
      return res.status(400).json({
        message: `${saleItem.productName} uchun maksimal vozvrat: ${leftQty}`
      });
    }

    const saleItem = matchingSaleItems[0];
    const unitPrice = Number(saleItem.unitPrice || 0);
    const costPrice = Number(saleItem.costPrice || 0);
    const lineTotal = roundMoney(unitPrice * item.quantity);
    const lineProfit = roundMoney((unitPrice - costPrice) * item.quantity);

    returnItems.push({
      productId: saleItem.productId,
      productName: saleItem.productName,
      unit: saleItem.unit,
<<<<<<< HEAD
      variantSize: requestedVariantSize,
      variantColor: requestedVariantColor,
=======
>>>>>>> b87c25050512a2ade573d01e46a21ed576558824
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

  const updatedStock = [];
  for (const item of returnItems) {
    const changed = item.variantSize && item.variantColor
      ? await Product.updateOne(
        tenantFilter(req, {
          _id: item.productId,
          variantStocks: { $elemMatch: { size: item.variantSize, color: item.variantColor } }
        }),
        { $inc: { quantity: item.quantity, "variantStocks.$.quantity": item.quantity } }
      )
      : await Product.updateOne(
        tenantFilter(req, { _id: item.productId }),
        { $inc: { quantity: item.quantity } }
      );
    if (changed.matchedCount !== 1) {
      for (const rollback of updatedStock) {
        if (rollback.variantSize && rollback.variantColor) {
          await Product.updateOne(
            tenantFilter(req, {
              _id: rollback.productId,
              variantStocks: { $elemMatch: { size: rollback.variantSize, color: rollback.variantColor } }
            }),
            { $inc: { quantity: -rollback.quantity, "variantStocks.$.quantity": -rollback.quantity } }
          );
        } else {
          await Product.updateOne(
            tenantFilter(req, { _id: rollback.productId }),
            { $inc: { quantity: -rollback.quantity } }
          );
        }
      }
      return res.status(409).json({ message: `${item.productName} omborda topilmadi` });
    }
    updatedStock.push({
      productId: item.productId,
      quantity: item.quantity,
      variantSize: item.variantSize || "",
      variantColor: item.variantColor || ""
    });
  }

  for (const item of returnItems) {
<<<<<<< HEAD
    let remainingQty = roundMoney(item.quantity);
    let targetRows = sale.items.filter((target) => {
      if (String(target.productId) !== String(item.productId)) return false;
      return String(target.variantSize || "").trim() === String(item.variantSize || "").trim()
        && String(target.variantColor || "").trim() === String(item.variantColor || "").trim();
    });
    if (targetRows.length < 1 && (item.variantSize || item.variantColor)) {
      targetRows = sale.items.filter((target) => {
        if (String(target.productId) !== String(item.productId)) return false;
        return !String(target.variantSize || "").trim() && !String(target.variantColor || "").trim();
      });
    }
=======
    const changed = await Product.updateOne(
      tenantFilter(req, { _id: item.productId }),
      { $inc: { quantity: item.quantity } }
    );
    if (changed.matchedCount !== 1) {
      for (const rollback of updatedStock) {
        await Product.updateOne(tenantFilter(req, { _id: rollback.productId }), { $inc: { quantity: -rollback.quantity } });
      }
      return res.status(409).json({ message: `${item.productName} omborda topilmadi` });
    }
    updatedStock.push({ productId: item.productId, quantity: item.quantity });
  }
>>>>>>> b87c25050512a2ade573d01e46a21ed576558824

    for (const target of targetRows) {
      if (remainingQty <= 0.0001) break;

      const soldQty = Number(target.quantity || 0);
      const returnedQty = Number(target.returnedQuantity || 0);
      const availableQty = roundMoney(soldQty - returnedQty);
      if (availableQty <= 0.0001) continue;

      const qtyForThisRow = roundMoney(Math.min(availableQty, remainingQty));
      const unitPrice = Number(target.unitPrice || 0);
      const costPrice = Number(target.costPrice || 0);

      target.returnedQuantity = roundMoney(Number(target.returnedQuantity || 0) + qtyForThisRow);
      target.returnedTotal = roundMoney(Number(target.returnedTotal || 0) + roundMoney(unitPrice * qtyForThisRow));
      target.returnedProfit = roundMoney(
        Number(target.returnedProfit || 0) + roundMoney((unitPrice - costPrice) * qtyForThisRow)
      );

      remainingQty = roundMoney(remainingQty - qtyForThisRow);
    }
  }

  sale.totalAmount = roundMoney(Math.max(0, Number(sale.totalAmount || 0) - returnTotal));
  sale.payments.cash = roundMoney(Math.max(0, Number(sale.payments?.cash || 0) - refundPayments.cash));
  sale.payments.card = roundMoney(Math.max(0, Number(sale.payments?.card || 0) - refundPayments.card));
  sale.payments.click = roundMoney(Math.max(0, Number(sale.payments?.click || 0) - refundPayments.click));

  if (sale.customerId) {
    const customer = await Customer.findOne(tenantFilter(req, { _id: sale.customerId }));
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

  if (sale.masterId && sale.vehicleId) {
    const master = await Master.findOne(tenantFilter(req, { _id: sale.masterId }));
    const vehicle = master?.vehicles?.id?.(sale.vehicleId) || null;
    if (vehicle) {
      if (paymentType === "debt") {
        vehicle.totalDebt = roundMoney(Math.max(0, Number(vehicle.totalDebt || 0) - returnTotal));
      } else {
        const refundedPaid = sumPayments(refundPayments);
        vehicle.totalPaid = roundMoney(Math.max(0, Number(vehicle.totalPaid || 0) - refundedPaid));
      }
      await master.save();
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
    tenantId: req.user.tenantId,
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
