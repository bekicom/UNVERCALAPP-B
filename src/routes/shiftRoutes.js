import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Sale } from "../models/Sale.js";
import { Shift } from "../models/Shift.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function getLocalDayRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
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

async function summarizeShift(req, shiftId) {
  const sales = await Sale.find(
    tenantFilter(req, {
      shiftId,
      entryType: { $ne: "opening_balance" },
      transactionType: { $ne: "debt_payment" }
    })
  ).lean();

  return sales.reduce(
    (acc, sale) => {
      const itemCount = (sale.items || []).reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
      );
      return {
        totalSalesCount: acc.totalSalesCount + 1,
        totalItemsCount: roundMoney(acc.totalItemsCount + itemCount),
        totalAmount: roundMoney(acc.totalAmount + Number(sale.totalAmount || 0)),
        totalCash: roundMoney(acc.totalCash + Number(sale.payments?.cash || 0)),
        totalCard: roundMoney(acc.totalCard + Number(sale.payments?.card || 0)),
        totalClick: roundMoney(acc.totalClick + Number(sale.payments?.click || 0)),
        totalDebt: roundMoney(acc.totalDebt + Number(sale.debtAmount || 0)),
        lastSaleAt: !acc.lastSaleAt || new Date(sale.createdAt).getTime() > new Date(acc.lastSaleAt).getTime()
          ? sale.createdAt
          : acc.lastSaleAt
      };
    },
    {
      totalSalesCount: 0,
      totalItemsCount: 0,
      totalAmount: 0,
      totalCash: 0,
      totalCard: 0,
      totalClick: 0,
      totalDebt: 0,
      lastSaleAt: null
    }
  );
}

router.get("/current", authMiddleware, async (req, res) => {
  const shift = await Shift.findOne(
    tenantFilter(req, { cashierId: req.user.id, status: "open" })
  )
    .sort({ openedAt: -1 })
    .lean();

  return res.json({ shift: shift || null });
});

router.post("/open", authMiddleware, async (req, res) => {
  const existing = await Shift.findOne(
    tenantFilter(req, { cashierId: req.user.id, status: "open" })
  ).sort({ openedAt: -1 });
  if (existing) {
    return res.json({ shift: existing });
  }

  const { start, end } = getLocalDayRange();
  const todaysShiftCount = await Shift.countDocuments(
    tenantFilter(req, {
      cashierId: req.user.id,
      openedAt: {
        $gte: start,
        $lt: end
      }
    })
  );

  if (todaysShiftCount >= 2) {
    return res.status(409).json({
      message: "Bu kassada bugun faqat 2 ta smena ochish mumkin"
    });
  }

  const shiftNumber = todaysShiftCount + 1;

  const shift = await Shift.create(
    withTenant(req, {
      cashierId: req.user.id,
      cashierUsername: req.user.username,
      shiftNumber,
      status: "open",
      openedAt: new Date()
    })
  );

  return res.status(201).json({ shift });
});

router.post("/current/close", authMiddleware, async (req, res) => {
  const shift = await Shift.findOne(
    tenantFilter(req, { cashierId: req.user.id, status: "open" })
  ).sort({ openedAt: -1 });
  if (!shift) {
    return res.status(404).json({ message: "Ochiq smena topilmadi" });
  }

  const summary = await summarizeShift(req, shift._id);
  shift.status = "closed";
  shift.closedAt = new Date();
  shift.totalSalesCount = summary.totalSalesCount;
  shift.totalItemsCount = summary.totalItemsCount;
  shift.totalAmount = summary.totalAmount;
  shift.totalCash = summary.totalCash;
  shift.totalCard = summary.totalCard;
  shift.totalClick = summary.totalClick;
  shift.totalDebt = summary.totalDebt;
  shift.lastSaleAt = summary.lastSaleAt;
  await shift.save();

  return res.json({ shift });
});

router.get("/", authMiddleware, async (req, res) => {
  const period = String(req.query?.period || "").toLowerCase();
  const from = String(req.query?.from || "");
  const to = String(req.query?.to || "");
  const cashierUsername = String(req.query?.cashierUsername || "").trim();
  const status = String(req.query?.status || "").trim().toLowerCase();
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), 300)
    : 200;

  const query = tenantFilter(req);
  const openedAtRange = buildDateRangeQuery({ period, from, to });
  if (openedAtRange) {
    query.openedAt = openedAtRange;
  }
  if (cashierUsername) {
    query.cashierUsername = cashierUsername;
  }
  if (["open", "closed"].includes(status)) {
    query.status = status;
  }

  const shifts = await Shift.find(query)
    .sort({ openedAt: -1 })
    .limit(limit)
    .lean();

  const summary = shifts.reduce(
    (acc, shift) => {
      acc.totalShifts += 1;
      if (shift.status === "open") acc.openShifts += 1;
      if (shift.status === "closed") acc.closedShifts += 1;
      acc.totalSalesCount += Number(shift.totalSalesCount || 0);
      acc.totalAmount = roundMoney(acc.totalAmount + Number(shift.totalAmount || 0));
      acc.totalCash = roundMoney(acc.totalCash + Number(shift.totalCash || 0));
      acc.totalCard = roundMoney(acc.totalCard + Number(shift.totalCard || 0));
      acc.totalClick = roundMoney(acc.totalClick + Number(shift.totalClick || 0));
      acc.totalDebt = roundMoney(acc.totalDebt + Number(shift.totalDebt || 0));
      return acc;
    },
    {
      totalShifts: 0,
      openShifts: 0,
      closedShifts: 0,
      totalSalesCount: 0,
      totalAmount: 0,
      totalCash: 0,
      totalCard: 0,
      totalClick: 0,
      totalDebt: 0
    }
  );

  return res.json({ shifts, summary });
});

export default router;
