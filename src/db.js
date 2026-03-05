import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./models/User.js";
import { Category } from "./models/Category.js";
import { Product } from "./models/Product.js";
import { Supplier } from "./models/Supplier.js";
import { Purchase } from "./models/Purchase.js";
import { AppSettings } from "./models/AppSettings.js";

const defaultMongoUri = "mongodb://127.0.0.1:27017/uy_dokon";
const allowedUnits = ["dona", "kg", "blok", "pachka", "qop"];

export async function initDb() {
  const mongoUri = process.env.MONGO_URI || defaultMongoUri;
  await mongoose.connect(mongoUri);

  const hasAdmin = await User.exists({ username: "admin" });
  if (!hasAdmin) {
    const passwordHash = bcrypt.hashSync("0000", 10);
    await User.create({
      username: "admin",
      passwordHash,
      role: "admin"
    });
  }

  const hasSettings = await AppSettings.exists({});
  if (!hasSettings) {
    await AppSettings.create({});
  }

  const categoryCount = await Category.countDocuments();
  if (categoryCount === 0) {
    await Category.create([
      { name: "Ichimlik" },
      { name: "Mevalar" },
      { name: "Shirinlik" }
    ]);
  }

  const supplierCount = await Supplier.countDocuments();
  if (supplierCount === 0) {
    await Supplier.create([
      { name: "Coca-Cola Tashkent", address: "Toshkent", phone: "+998900000001" },
      { name: "Mijoz Servis", address: "Toshkent", phone: "+998900000002" }
    ]);
  }

  // Migrate legacy products to new schema fields.
  const fallbackCategory = await Category.findOne().lean();
  if (fallbackCategory) {
    const fallbackSupplier = await Supplier.findOne().lean();
    const legacyProducts = await Product.find().lean();
    for (const p of legacyProducts) {
      const patch = {};

      if (!p.categoryId) {
        patch.categoryId = fallbackCategory._id;
      }
      if (typeof p.retailPrice !== "number") {
        patch.retailPrice = typeof p.salePrice === "number" ? p.salePrice : 0;
      }
      if (typeof p.wholesalePrice !== "number") {
        patch.wholesalePrice = typeof p.salePrice === "number" ? p.salePrice : 0;
      }
      if (!p.unit) {
        patch.unit = "dona";
      } else {
        const safeUnit = String(p.unit).toLowerCase();
        patch.unit = allowedUnits.includes(safeUnit) ? safeUnit : "dona";
      }
      if (typeof p.allowPieceSale !== "boolean") {
        patch.allowPieceSale = false;
      }
      if (!p.pieceUnit || !allowedUnits.includes(String(p.pieceUnit).toLowerCase())) {
        patch.pieceUnit = "kg";
      }
      if (typeof p.pieceQtyPerBase !== "number" || p.pieceQtyPerBase < 0) {
        patch.pieceQtyPerBase = 0;
      }
      if (typeof p.piecePrice !== "number" || p.piecePrice < 0) {
        patch.piecePrice = 0;
      }
      if (!p.supplierId && fallbackSupplier) {
        patch.supplierId = fallbackSupplier._id;
      }
      const totalCost = Number(p.totalPurchaseCost);
      if (!Number.isFinite(totalCost) || totalCost < 0) {
        const qty = Number(p.quantity) || 0;
        const buy = Number(p.purchasePrice) || 0;
        patch.totalPurchaseCost = qty * buy;
      }
      if (!["naqd", "qarz", "qisman"].includes(String(p.paymentType || "").toLowerCase())) {
        patch.paymentType = "naqd";
      }
      const total = Number.isFinite(Number(p.totalPurchaseCost))
        ? Number(p.totalPurchaseCost)
        : (Number(p.quantity) || 0) * (Number(p.purchasePrice) || 0);
      if (typeof p.paidAmount !== "number" || p.paidAmount < 0) {
        patch.paidAmount = total;
      }
      if (typeof p.debtAmount !== "number" || p.debtAmount < 0) {
        patch.debtAmount = 0;
      }

      if (Object.keys(patch).length > 0) {
        await Product.updateOne({ _id: p._id }, { $set: patch });
      }
    }

    // Backfill purchase history for legacy products that have no purchase log.
    const products = await Product.find().lean();
    for (const p of products) {
      const hasPurchase = await Purchase.exists({ productId: p._id });
      if (hasPurchase) continue;

      const qty = Number(p.quantity) || 0;
      const buy = Number(p.purchasePrice) || 0;
      const total = (Number(p.totalPurchaseCost) || qty * buy);
      const paid = Number.isFinite(Number(p.paidAmount)) ? Number(p.paidAmount) : total;
      const debt = Number.isFinite(Number(p.debtAmount)) ? Number(p.debtAmount) : Math.max(0, total - paid);

      if (!p.supplierId) continue;

      await Purchase.create({
        entryType: "initial",
        supplierId: p.supplierId,
        productId: p._id,
        productName: p.name,
        productModel: p.model,
        quantity: qty,
        unit: p.unit || "dona",
        purchasePrice: buy,
        totalCost: total,
        paidAmount: paid,
        debtAmount: debt,
        paymentType: p.paymentType || "naqd",
        pricingMode: "replace_all",
        purchasedAt: p.createdAt || new Date()
      });
    }
  }
}
