import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";

const router = Router();
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/", authMiddleware, async (_, res) => {
  const categories = await Category.find().sort({ name: 1 }).lean();
  res.json({ categories });
});

router.post("/", authMiddleware, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ message: "Kategoriya nomi kerak" });

  const exists = await Category.exists({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } });
  if (exists) return res.status(409).json({ message: "Bu kategoriya mavjud" });

  const category = await Category.create({ name });
  res.status(201).json({ category });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const used = await Product.exists({ categoryId: id });
  if (used) return res.status(400).json({ message: "Bu kategoriyada mahsulot bor, o'chirib bo'lmaydi" });

  const deleted = await Category.findByIdAndDelete(id);
  if (!deleted) return res.status(404).json({ message: "Kategoriya topilmadi" });

  res.json({ ok: true });
});

export default router;
