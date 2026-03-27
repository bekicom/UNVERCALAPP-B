import mongoose from "mongoose";
import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Master } from "../models/Master.js";
import { MasterPayment } from "../models/MasterPayment.js";
import { Sale } from "../models/Sale.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Faqat admin uchun" });
  }
  next();
}

function normalizePlate(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function formatMaster(master) {
  const vehicles = (master.vehicles || []).map((vehicle) => ({
    _id: vehicle._id,
    plateNumber: vehicle.plateNumber,
    model: vehicle.model || "",
    totalDebt: roundMoney(vehicle.totalDebt || 0),
    totalPaid: roundMoney(vehicle.totalPaid || 0),
    lastSaleAt: vehicle.lastSaleAt || null
  }));

  const stats = vehicles.reduce((acc, vehicle) => {
    acc.totalVehicles += 1;
    acc.activeVehicles += Number(vehicle.totalDebt || 0) > 0 ? 1 : 0;
    acc.totalDebt = roundMoney(acc.totalDebt + Number(vehicle.totalDebt || 0));
    acc.totalPaid = roundMoney(acc.totalPaid + Number(vehicle.totalPaid || 0));
    return acc;
  }, {
    totalVehicles: 0,
    activeVehicles: 0,
    totalDebt: 0,
    totalPaid: 0
  });

  return {
    _id: master._id,
    fullName: master.fullName,
    phone: master.phone || "",
    notes: master.notes || "",
    vehicles,
    stats
  };
}

router.get("/", authMiddleware, requireAdmin, async (req, res) => {
  const q = String(req.query?.q || "").trim();
  const query = tenantFilter(req);

  if (q) {
    const safe = escapeRegex(q);
    query.$or = [
      { fullName: { $regex: safe, $options: "i" } },
      { phone: { $regex: safe, $options: "i" } },
      { "vehicles.plateNumber": { $regex: safe, $options: "i" } },
      { "vehicles.model": { $regex: safe, $options: "i" } }
    ];
  }

  const docs = await Master.find(query).sort({ updatedAt: -1 }).lean();
  const masters = docs.map(formatMaster);
  const summary = masters.reduce((acc, master) => {
    acc.totalMasters += 1;
    acc.totalVehicles += Number(master.stats?.totalVehicles || 0);
    acc.activeVehicles += Number(master.stats?.activeVehicles || 0);
    acc.totalDebt = roundMoney(acc.totalDebt + Number(master.stats?.totalDebt || 0));
    acc.totalPaid = roundMoney(acc.totalPaid + Number(master.stats?.totalPaid || 0));
    return acc;
  }, {
    totalMasters: 0,
    totalVehicles: 0,
    activeVehicles: 0,
    totalDebt: 0,
    totalPaid: 0
  });

  res.json({ masters, summary });
});

router.get("/lookup", authMiddleware, async (req, res) => {
  const q = String(req.query?.q || "").trim();
  const query = tenantFilter(req);

  if (q) {
    const safe = escapeRegex(q);
    query.$or = [
      { fullName: { $regex: safe, $options: "i" } },
      { phone: { $regex: safe, $options: "i" } },
      { "vehicles.plateNumber": { $regex: safe, $options: "i" } },
      { "vehicles.model": { $regex: safe, $options: "i" } }
    ];
  }

  const docs = await Master.find(query)
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();

  res.json({
    masters: docs.map((master) => ({
      _id: master._id,
      fullName: master.fullName,
      phone: master.phone || "",
      vehicles: (master.vehicles || []).map((vehicle) => ({
        _id: vehicle._id,
        plateNumber: vehicle.plateNumber,
        model: vehicle.model || "",
        totalDebt: roundMoney(vehicle.totalDebt || 0)
      }))
    }))
  });
});

router.get("/:id/ledger", authMiddleware, requireAdmin, async (req, res) => {
  const vehicleId = String(req.query?.vehicleId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
    return res.status(400).json({ message: "Mashina topilmadi" });
  }

  const master = await Master.findOne(tenantFilter(req, { _id: req.params.id })).lean();
  if (!master) return res.status(404).json({ message: "Usta topilmadi" });

  const vehicle = (master.vehicles || []).find((entry) => String(entry._id) === vehicleId);
  if (!vehicle) return res.status(404).json({ message: "Mashina topilmadi" });

  const [sales, payments] = await Promise.all([
    Sale.find(tenantFilter(req, { masterId: master._id, vehicleId: vehicle._id }))
      .sort({ createdAt: -1 })
      .lean(),
    MasterPayment.find(tenantFilter(req, { masterId: master._id, vehicleId: vehicle._id }))
      .sort({ paidAt: -1 })
      .lean()
  ]);

  const totals = {
    totalSalesAmount: roundMoney(sales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0)),
    totalDebt: roundMoney(vehicle.totalDebt || 0),
    totalPaid: roundMoney(vehicle.totalPaid || 0)
  };

  res.json({
    master: {
      _id: master._id,
      fullName: master.fullName,
      phone: master.phone || ""
    },
    vehicle: {
      _id: vehicle._id,
      plateNumber: vehicle.plateNumber,
      model: vehicle.model || ""
    },
    sales,
    payments,
    totals
  });
});

router.post("/:id/vehicles/:vehicleId/payments", authMiddleware, requireAdmin, async (req, res) => {
  const master = await Master.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!master) return res.status(404).json({ message: "Usta topilmadi" });

  const vehicle = master.vehicles.id(req.params.vehicleId);
  if (!vehicle) return res.status(404).json({ message: "Mashina topilmadi" });

  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || "").trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "To'lov summasi 0 dan katta bo'lishi kerak" });
  }
  if (Number(vehicle.totalDebt || 0) <= 0) {
    return res.status(400).json({ message: "Bu mashinada ochiq qarz yo'q" });
  }

  const openSales = await Sale.find(tenantFilter(req, {
    masterId: master._id,
    vehicleId: vehicle._id,
    debtAmount: { $gt: 0 }
  })).sort({ createdAt: 1, _id: 1 });

  if (openSales.length < 1) {
    vehicle.totalDebt = 0;
    await master.save();
    return res.status(400).json({ message: "Qarz topilmadi, ma'lumot yangilandi" });
  }

  const totalDebtBefore = roundMoney(openSales.reduce((sum, sale) => sum + Number(sale.debtAmount || 0), 0));
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

  vehicle.totalDebt = roundMoney(Math.max(0, Number(vehicle.totalDebt || 0) - payable));
  vehicle.totalPaid = roundMoney(Number(vehicle.totalPaid || 0) + payable);
  await master.save();

  const payment = await MasterPayment.create(withTenant(req, {
    masterId: master._id,
    vehicleId: vehicle._id,
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
    totalDebtAfter: vehicle.totalDebt
  });
});

export default router;
