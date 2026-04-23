import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Tenant } from "../models/Tenant.js";

const router = Router();

router.get("/login-users", async (req, res) => {
  try {
    const tenantSlug = String(req.query?.tenantSlug || "")
      .trim()
      .toLowerCase();

    let tenant = null;
    if (tenantSlug) {
      tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true }).lean();
      if (!tenant) {
        return res.json({ users: [] });
      }
    }

    const filter = tenant ? { tenantId: tenant._id } : {};
    const users = await User.find(filter)
      .select("username role createdAt")
      .sort({ createdAt: 1 })
      .lean();

    const seen = new Set();
    const loginUsers = [];
    for (const user of users) {
      const username = String(user.username || "").trim();
      if (!username) continue;
      const key = username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      loginUsers.push({
        username,
        role: String(user.role || "cashier"),
      });
    }

    return res.json({ users: loginUsers });
  } catch {
    return res.status(500).json({ message: "Foydalanuvchilarni olishda xatolik" });
  }
});

router.post("/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const tenantSlug = String(req.body?.tenantSlug || "").trim().toLowerCase();

  if (!username || !password) {
    return res.status(400).json({ message: "Username va parol kerak" });
  }

  let tenant = null;
  if (tenantSlug) {
    tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true }).lean();
    if (!tenant) {
      return res.status(401).json({ message: "Tenant topilmadi yoki bloklangan" });
    }
  }

  let user = null;
  if (tenant) {
    user = await User.findOne({ tenantId: tenant._id, username }).lean();
  } else {
    const users = await User.find({ username }).sort({ createdAt: 1 }).limit(2).lean();
    if (users.length > 1) {
      return res.status(400).json({ message: "Bir xil login bir nechta filialda bor. Tenant kodini kiriting" });
    }
    user = users[0] || null;
  }

  if (!user) {
    return res.status(401).json({ message: "Login yoki parol noto'g'ri" });
  }

  // Tenantni har doim tekshirish: no-tenant login holatida ham.
  const resolvedTenant = tenant || await Tenant.findOne({ _id: user.tenantId }).lean();
  if (!resolvedTenant || !resolvedTenant.isActive) {
    return res.status(401).json({ message: "Tenant topilmadi yoki bloklangan" });
  }

  const isValid = bcrypt.compareSync(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ message: "Login yoki parol noto'g'ri" });
  }

  const token = jwt.sign(
    { id: user._id, tenantId: String(user.tenantId), username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  return res.json({
    token,
    user: {
      id: user._id,
      tenantId: user.tenantId,
      tenantSlug: resolvedTenant?.slug || null,
      username: user.username,
      role: user.role
    }
  });
});

export default router;
