import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Expense } from "../models/Expense.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();

router.get("/", authMiddleware, async (req, res) => {
  const expenses = await Expense.find(tenantFilter(req)).sort({ spentAt: -1, createdAt: -1 }).lean();
  res.json({ expenses });
});

router.post("/", authMiddleware, async (req, res) => {
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || "").trim();
  const spentAt = req.body?.spentAt ? new Date(req.body.spentAt) : new Date();

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "Xarajat summasi 0 dan katta bo'lishi kerak" });
  }
  if (!reason) {
    return res.status(400).json({ message: "Xarajat sababi kiritilishi kerak" });
  }
  if (Number.isNaN(spentAt.getTime())) {
    return res.status(400).json({ message: "Sana noto'g'ri" });
  }

  const expense = await Expense.create(withTenant(req, { amount, reason, spentAt }));
  res.status(201).json({ expense });
});

router.put("/:id", authMiddleware, async (req, res) => {
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || "").trim();
  const spentAt = req.body?.spentAt ? new Date(req.body.spentAt) : new Date();

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "Xarajat summasi 0 dan katta bo'lishi kerak" });
  }
  if (!reason) {
    return res.status(400).json({ message: "Xarajat sababi kiritilishi kerak" });
  }
  if (Number.isNaN(spentAt.getTime())) {
    return res.status(400).json({ message: "Sana noto'g'ri" });
  }

  const updated = await Expense.findOneAndUpdate(
    tenantFilter(req, { _id: req.params.id }),
    { amount, reason, spentAt },
    { new: true, runValidators: true }
  );

  if (!updated) return res.status(404).json({ message: "Xarajat topilmadi" });
  res.json({ expense: updated });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const deleted = await Expense.findOneAndDelete(tenantFilter(req, { _id: req.params.id }));
  if (!deleted) return res.status(404).json({ message: "Xarajat topilmadi" });
  res.json({ ok: true });
});

export default router;
