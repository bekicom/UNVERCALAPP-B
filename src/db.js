import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Tenant } from "./models/Tenant.js";
import { User } from "./models/User.js";
import { Category } from "./models/Category.js";
import { Product } from "./models/Product.js";
import { Supplier } from "./models/Supplier.js";
import { Purchase } from "./models/Purchase.js";
import { AppSettings } from "./models/AppSettings.js";
import { Sale } from "./models/Sale.js";
import { Expense } from "./models/Expense.js";
import { Warehouse } from "./models/Warehouse.js";
import { Customer } from "./models/Customer.js";
import { CustomerPayment } from "./models/CustomerPayment.js";
import { SupplierPayment } from "./models/SupplierPayment.js";

const defaultMongoUri = "mongodb://127.0.0.1:27017/unvercalapp";
const allowedUnits = ["dona", "kg", "blok", "pachka", "qop"];

async function ensureDefaultTenant() {
  const slug = String(process.env.DEFAULT_TENANT_SLUG || "default").trim().toLowerCase();
  const name = String(process.env.DEFAULT_TENANT_NAME || "Default Tenant").trim();
  let tenant = await Tenant.findOne({ slug });
  if (!tenant) {
    tenant = await Tenant.create({ name, slug, isActive: true });
  }
  return tenant;
}

async function backfillTenantId(defaultTenantId) {
  const setTenant = { $set: { tenantId: defaultTenantId } };
  const missing = { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] };

  await Promise.all([
    User.updateMany(missing, setTenant),
    Category.updateMany(missing, setTenant),
    Supplier.updateMany(missing, setTenant),
    Product.updateMany(missing, setTenant),
    Purchase.updateMany(missing, setTenant),
    Sale.updateMany(missing, setTenant),
    Expense.updateMany(missing, setTenant),
    Warehouse.updateMany(missing, setTenant),
    Customer.updateMany(missing, setTenant),
    CustomerPayment.updateMany(missing, setTenant),
    SupplierPayment.updateMany(missing, setTenant),
    AppSettings.updateMany(missing, setTenant)
  ]);

  await Sale.updateMany(
    { returns: { $elemMatch: { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] } } },
    [
      {
        $set: {
          returns: {
            $map: {
              input: { $ifNull: ["$returns", []] },
              as: "ret",
              in: {
                $mergeObjects: [
                  { tenantId: "$tenantId" },
                  "$$ret"
                ]
              }
            }
          }
        }
      }
    ]
  );
}

async function dropLegacyUniqueIndexes() {
  const drops = [
    [User.collection, "username_1"],
    [Category.collection, "name_1"],
    [Supplier.collection, "name_1"],
    [Warehouse.collection, "name_1"],
    [Customer.collection, "phone_1"]
  ];

  for (const [collection, indexName] of drops) {
    try {
      const indexes = await collection.indexes();
      if (indexes.some((idx) => idx.name === indexName)) {
        await collection.dropIndex(indexName);
      }
    } catch {
      // ignore legacy index drop errors; app can continue
    }
  }
}

export async function initDb() {
  const mongoUri = process.env.MONGO_URI || defaultMongoUri;
  await mongoose.connect(mongoUri);

  const defaultTenant = await ensureDefaultTenant();
  await backfillTenantId(defaultTenant._id);
  await dropLegacyUniqueIndexes();

  const hasAdmin = await User.exists({ tenantId: defaultTenant._id, username: "admin" });
  if (!hasAdmin) {
    const passwordHash = bcrypt.hashSync("0000", 10);
    await User.create({
      tenantId: defaultTenant._id,
      username: "admin",
      passwordHash,
      role: "admin"
    });
  }

  const hasSettings = await AppSettings.exists({ tenantId: defaultTenant._id });
  if (!hasSettings) {
    await AppSettings.create({ tenantId: defaultTenant._id });
  }

  const categoryCount = await Category.countDocuments({ tenantId: defaultTenant._id });
  if (categoryCount === 0) {
    await Category.create([
      { tenantId: defaultTenant._id, name: "Ichimlik" },
      { tenantId: defaultTenant._id, name: "Mevalar" },
      { tenantId: defaultTenant._id, name: "Shirinlik" }
    ]);
  }

  const supplierCount = await Supplier.countDocuments({ tenantId: defaultTenant._id });
  if (supplierCount === 0) {
    await Supplier.create([
      { tenantId: defaultTenant._id, name: "Coca-Cola Tashkent", address: "Toshkent", phone: "+998900000001" },
      { tenantId: defaultTenant._id, name: "Mijoz Servis", address: "Toshkent", phone: "+998900000002" }
    ]);
  }

  // Migrate legacy products to new schema fields.
  const fallbackCategory = await Category.findOne({ tenantId: defaultTenant._id }).lean();
  if (fallbackCategory) {
    const fallbackSupplier = await Supplier.findOne({ tenantId: defaultTenant._id }).lean();
    const legacyProducts = await Product.find({ tenantId: defaultTenant._id }).lean();
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
        await Product.updateOne({ _id: p._id, tenantId: defaultTenant._id }, { $set: patch });
      }
    }

    // Backfill purchase history for legacy products that have no purchase log.
    const products = await Product.find({ tenantId: defaultTenant._id }).lean();
    for (const p of products) {
      const hasPurchase = await Purchase.exists({ tenantId: defaultTenant._id, productId: p._id });
      if (hasPurchase) continue;

      const qty = Number(p.quantity) || 0;
      const buy = Number(p.purchasePrice) || 0;
      const total = (Number(p.totalPurchaseCost) || qty * buy);
      const paid = Number.isFinite(Number(p.paidAmount)) ? Number(p.paidAmount) : total;
      const debt = Number.isFinite(Number(p.debtAmount)) ? Number(p.debtAmount) : Math.max(0, total - paid);

      if (!p.supplierId) continue;

      await Purchase.create({
        tenantId: defaultTenant._id,
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
