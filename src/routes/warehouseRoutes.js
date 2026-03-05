import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Warehouse } from "../models/Warehouse.js";

const router = Router();
const allowedTypes = ["asosiy", "kichik"];

function normalizePayload(body) {
  return {
    name: String(body?.name || "").trim(),
    type: String(body?.type || "")
      .toLowerCase()
      .trim(),
    note: String(body?.note || "").trim(),
  };
}

router.get("/", authMiddleware, async (_, res) => {
  const warehouses = await Warehouse.find().sort({ createdAt: 1 }).lean();
  res.json({ warehouses });
});

router.post("/", authMiddleware, async (req, res) => {
  const { name, type, note } = normalizePayload(req.body);

  if (!name || !type) {
    return res.status(400).json({ message: "Nomi va turi kerak" });
  }

  if (!allowedTypes.includes(type)) {
    return res
      .status(400)
      .json({ message: "Tur faqat asosiy yoki kichik bo'lishi kerak" });
  }

  const exists = await Warehouse.exists({ name });
  if (exists) {
    return res.status(409).json({ message: "Bunday ombor allaqachon bor" });
  }

  const warehouse = await Warehouse.create({
    name,
    type,
    note,
  });

  return res.status(201).json({ warehouse });
});

router.put("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, type, note } = normalizePayload(req.body);

  if (!name || !type) {
    return res.status(400).json({ message: "Nomi va turi kerak" });
  }

  if (!allowedTypes.includes(type)) {
    return res
      .status(400)
      .json({ message: "Tur faqat asosiy yoki kichik bo'lishi kerak" });
  }

  const duplicate = await Warehouse.exists({ name, _id: { $ne: id } });
  if (duplicate) {
    return res.status(409).json({ message: "Bu nomdagi ombor mavjud" });
  }

  const updated = await Warehouse.findByIdAndUpdate(
    id,
    { name, type, note },
    { new: true, runValidators: true },
  );

  if (!updated) {
    return res.status(404).json({ message: "Ombor topilmadi" });
  }

  return res.json({ warehouse: updated });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const deleted = await Warehouse.findByIdAndDelete(id);

  if (!deleted) {
    return res.status(404).json({ message: "Ombor topilmadi" });
  }

  return res.json({ ok: true });
});

export default router;
