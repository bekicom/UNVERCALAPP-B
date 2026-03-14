import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/", authMiddleware, async (req, res) => {
  const categories = await Category.find(tenantFilter(req)).sort({ name: 1 }).lean();
  res.json({ categories });
});

router.post("/", authMiddleware, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ message: "Kategoriya nomi kerak" });

  const exists = await Category.exists(tenantFilter(req, { name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } }));
  if (exists) return res.status(409).json({ message: "Bu kategoriya mavjud" });

  const category = await Category.create(withTenant(req, { name }));
  res.status(201).json({ category });
});

router.put("/:id", authMiddleware, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ message: "Kategoriya nomi kerak" });

  const duplicate = await Category.exists(tenantFilter(req, {
    _id: { $ne: req.params.id },
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" }
  }));
  if (duplicate) return res.status(409).json({ message: "Bu kategoriya mavjud" });

  const updated = await Category.findOneAndUpdate(
    tenantFilter(req, { _id: req.params.id }),
    { name },
    { new: true, runValidators: true }
  );
  if (!updated) return res.status(404).json({ message: "Kategoriya topilmadi" });

  res.json({ category: updated });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const used = await Product.exists(tenantFilter(req, { categoryId: id }));
  if (used) return res.status(400).json({ message: "Bu kategoriyada mahsulot bor, o'chirib bo'lmaydi" });

  const deleted = await Category.findOneAndDelete(tenantFilter(req, { _id: id }));
  if (!deleted) return res.status(404).json({ message: "Kategoriya topilmadi" });

  res.json({ ok: true });
});

export default router;
