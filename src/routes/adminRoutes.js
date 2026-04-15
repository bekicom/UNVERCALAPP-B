<<<<<<< HEAD
import { Router } from "express";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../authMiddleware.js";
import { User } from "../models/User.js";
import { Product } from "../models/Product.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();
const ROLES = ["admin", "cashier"];
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Faqat admin uchun" });
  }
  next();
}

router.get("/overview", authMiddleware, async (req, res) => {
  const [users, products] = await Promise.all([
    User.countDocuments(tenantFilter(req)),
    Product.countDocuments(tenantFilter(req))
  ]);

  return res.json({
    message: "Admin panelga xush kelibsiz",
    stats: {
      users,
      products
    },
    admin: req.user
  });
});

router.get("/users", authMiddleware, requireAdmin, async (req, res) => {
  const users = await User.find(tenantFilter(req)).select("_id username role createdAt updatedAt").sort({ createdAt: -1 }).lean();
  res.json({ users });
});

router.post("/users", authMiddleware, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "").toLowerCase();

  if (!username || !password || !role) {
    return res.status(400).json({ message: "Username, parol va rol kerak" });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Rol noto'g'ri" });
  }
  if (password.length < 4) {
    return res.status(400).json({ message: "Parol kamida 4 ta belgidan iborat bo'lsin" });
  }

  const exists = await User.exists(tenantFilter(req, { username: { $regex: `^${escapeRegex(username)}$`, $options: "i" } }));
  if (exists) return res.status(409).json({ message: "Bu username band" });

  const passwordHash = bcrypt.hashSync(password, 10);
  const user = await User.create(withTenant(req, { username, passwordHash, role }));

  res.status(201).json({
    user: { _id: user._id, username: user.username, role: user.role, createdAt: user.createdAt, updatedAt: user.updatedAt }
  });
});

router.put("/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const role = String(req.body?.role || "").toLowerCase();
  const password = req.body?.password == null ? "" : String(req.body.password);

  if (!username || !role) {
    return res.status(400).json({ message: "Username va rol kerak" });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Rol noto'g'ri" });
  }

  const user = await User.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });

  const duplicate = await User.exists(tenantFilter(req, {
    _id: { $ne: req.params.id },
    username: { $regex: `^${escapeRegex(username)}$`, $options: "i" }
  }));
  if (duplicate) return res.status(409).json({ message: "Bu username band" });

  user.username = username;
  user.role = role;

  if (password) {
    if (password.length < 4) {
      return res.status(400).json({ message: "Parol kamida 4 ta belgidan iborat bo'lsin" });
    }
    user.passwordHash = bcrypt.hashSync(password, 10);
  }

  // keep at least one admin in system
  if (user.role !== "admin") {
    const adminCount = await User.countDocuments(tenantFilter(req, { role: "admin", _id: { $ne: user._id } }));
    if (adminCount < 1) {
      return res.status(400).json({ message: "Kamida 1 ta admin qolishi kerak" });
    }
  }

  await user.save();
  res.json({
    user: { _id: user._id, username: user.username, role: user.role, createdAt: user.createdAt, updatedAt: user.updatedAt }
  });
});

router.delete("/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  const user = await User.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!user) {
    return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
  }

  if (String(user._id) === String(req.user?.id || "")) {
    return res.status(400).json({ message: "O'zingizni o'chira olmaysiz" });
  }

  if (user.role === "admin") {
    const adminCount = await User.countDocuments(
      tenantFilter(req, { role: "admin", _id: { $ne: user._id } })
    );
    if (adminCount < 1) {
      return res.status(400).json({ message: "Kamida 1 ta admin qolishi kerak" });
    }
  }

  await User.deleteOne({ _id: user._id });
  res.json({ ok: true });
});

export default router;
=======
import { Router } from "express";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../authMiddleware.js";
import { User } from "../models/User.js";
import { Product } from "../models/Product.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();
const ROLES = ["admin", "cashier"];
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Faqat admin uchun" });
  }
  next();
}

router.get("/overview", authMiddleware, async (req, res) => {
  const [users, products] = await Promise.all([
    User.countDocuments(tenantFilter(req)),
    Product.countDocuments(tenantFilter(req))
  ]);

  return res.json({
    message: "Admin panelga xush kelibsiz",
    stats: {
      users,
      products
    },
    admin: req.user
  });
});

router.get("/users", authMiddleware, requireAdmin, async (req, res) => {
  const users = await User.find(tenantFilter(req)).select("_id username role createdAt updatedAt").sort({ createdAt: -1 }).lean();
  res.json({ users });
});

router.post("/users", authMiddleware, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "").toLowerCase();

  if (!username || !password || !role) {
    return res.status(400).json({ message: "Username, parol va rol kerak" });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Rol noto'g'ri" });
  }
  if (password.length < 4) {
    return res.status(400).json({ message: "Parol kamida 4 ta belgidan iborat bo'lsin" });
  }

  const exists = await User.exists(tenantFilter(req, { username: { $regex: `^${escapeRegex(username)}$`, $options: "i" } }));
  if (exists) return res.status(409).json({ message: "Bu username band" });

  const passwordHash = bcrypt.hashSync(password, 10);
  const user = await User.create(withTenant(req, { username, passwordHash, role }));

  res.status(201).json({
    user: { _id: user._id, username: user.username, role: user.role, createdAt: user.createdAt, updatedAt: user.updatedAt }
  });
});

router.put("/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const role = String(req.body?.role || "").toLowerCase();
  const password = req.body?.password == null ? "" : String(req.body.password);

  if (!username || !role) {
    return res.status(400).json({ message: "Username va rol kerak" });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Rol noto'g'ri" });
  }

  const user = await User.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });

  const duplicate = await User.exists(tenantFilter(req, {
    _id: { $ne: req.params.id },
    username: { $regex: `^${escapeRegex(username)}$`, $options: "i" }
  }));
  if (duplicate) return res.status(409).json({ message: "Bu username band" });

  user.username = username;
  user.role = role;

  if (password) {
    if (password.length < 4) {
      return res.status(400).json({ message: "Parol kamida 4 ta belgidan iborat bo'lsin" });
    }
    user.passwordHash = bcrypt.hashSync(password, 10);
  }

  // keep at least one admin in system
  if (user.role !== "admin") {
    const adminCount = await User.countDocuments(tenantFilter(req, { role: "admin", _id: { $ne: user._id } }));
    if (adminCount < 1) {
      return res.status(400).json({ message: "Kamida 1 ta admin qolishi kerak" });
    }
  }

  await user.save();
  res.json({
    user: { _id: user._id, username: user.username, role: user.role, createdAt: user.createdAt, updatedAt: user.updatedAt }
  });
});

export default router;
>>>>>>> b87c25050512a2ade573d01e46a21ed576558824
