import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { Category } from "../src/models/Category.js";
import { Expense } from "../src/models/Expense.js";
import { Product } from "../src/models/Product.js";
import { Purchase } from "../src/models/Purchase.js";
import { Supplier } from "../src/models/Supplier.js";
import { SupplierPayment } from "../src/models/SupplierPayment.js";
import { Tenant } from "../src/models/Tenant.js";
import { User } from "../src/models/User.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unvercalapp";

const categoriesData = [
  "Ichimlik",
  "Shirinlik",
  "Sut mahsulotlari",
  "Gigiyena",
  "Konserva",
  "Un mahsulotlari"
];

const suppliersData = [
  { name: "Baraka Trade", address: "Toshkent, Chilonzor", phone: "+998901111111" },
  { name: "Samarkand Distrib", address: "Samarqand, Registon", phone: "+998902222222" },
  { name: "Orient Supply", address: "Toshkent, Yunusobod", phone: "+998903333333" }
];

const productsData = [
  { name: "Coca-Cola", model: "1.5L", category: "Ichimlik", supplier: "Baraka Trade", quantity: 80, unit: "dona", purchasePrice: 8500, retailPrice: 11000, wholesalePrice: 10500, paymentType: "naqd", allowPieceSale: false },
  { name: "Fanta", model: "1L", category: "Ichimlik", supplier: "Baraka Trade", quantity: 60, unit: "dona", purchasePrice: 7000, retailPrice: 9500, wholesalePrice: 9000, paymentType: "qisman", paidAmount: 300000, allowPieceSale: false },
  { name: "Pepsi", model: "2L", category: "Ichimlik", supplier: "Samarkand Distrib", quantity: 45, unit: "dona", purchasePrice: 9800, retailPrice: 12500, wholesalePrice: 11800, paymentType: "qarz", allowPieceSale: false },
  { name: "Choco Pie", model: "12 dona", category: "Shirinlik", supplier: "Orient Supply", quantity: 35, unit: "blok", purchasePrice: 42000, retailPrice: 51000, wholesalePrice: 49000, paymentType: "naqd", allowPieceSale: false },
  { name: "Snickers", model: "50g", category: "Shirinlik", supplier: "Orient Supply", quantity: 140, unit: "dona", purchasePrice: 7500, retailPrice: 10000, wholesalePrice: 9500, paymentType: "qisman", paidAmount: 700000, allowPieceSale: false },
  { name: "Qatiq", model: "1L", category: "Sut mahsulotlari", supplier: "Samarkand Distrib", quantity: 50, unit: "dona", purchasePrice: 7800, retailPrice: 10000, wholesalePrice: 9500, paymentType: "naqd", allowPieceSale: false },
  { name: "Saryog", model: "200g", category: "Sut mahsulotlari", supplier: "Samarkand Distrib", quantity: 70, unit: "pachka", purchasePrice: 15500, retailPrice: 19500, wholesalePrice: 18500, paymentType: "qisman", paidAmount: 900000, allowPieceSale: false },
  { name: "Shampun", model: "400ml", category: "Gigiyena", supplier: "Baraka Trade", quantity: 40, unit: "dona", purchasePrice: 23000, retailPrice: 29500, wholesalePrice: 28000, paymentType: "qarz", allowPieceSale: false },
  { name: "Kir sovun", model: "72%", category: "Gigiyena", supplier: "Baraka Trade", quantity: 110, unit: "dona", purchasePrice: 5200, retailPrice: 7500, wholesalePrice: 7000, paymentType: "naqd", allowPieceSale: false },
  { name: "Yashil no'xat", model: "425g", category: "Konserva", supplier: "Orient Supply", quantity: 95, unit: "dona", purchasePrice: 9800, retailPrice: 13000, wholesalePrice: 12200, paymentType: "qisman", paidAmount: 500000, allowPieceSale: false },
  { name: "Guruch", model: "Premium", category: "Un mahsulotlari", supplier: "Samarkand Distrib", quantity: 12, unit: "qop", purchasePrice: 540000, retailPrice: 620000, wholesalePrice: 605000, paymentType: "qarz", allowPieceSale: true, pieceUnit: "kg", pieceQtyPerBase: 50, piecePrice: 13500 },
  { name: "Un", model: "1-nav", category: "Un mahsulotlari", supplier: "Samarkand Distrib", quantity: 18, unit: "qop", purchasePrice: 310000, retailPrice: 370000, wholesalePrice: 355000, paymentType: "qisman", paidAmount: 3500000, allowPieceSale: true, pieceUnit: "kg", pieceQtyPerBase: 50, piecePrice: 7900 }
];

const expensesData = [
  { amount: 180000, reason: "Do'kon tozalash va xo'jalik", spentAt: new Date("2026-03-01T10:30:00.000Z") },
  { amount: 950000, reason: "Ijara to'lovi (qisman)", spentAt: new Date("2026-03-02T09:00:00.000Z") },
  { amount: 220000, reason: "Yetkazib berish transport xarajati", spentAt: new Date("2026-03-03T12:10:00.000Z") }
];

async function ensureCashierUsers(tenantId) {
  const cashierUsers = [
    { username: "kassir1", password: "1111", role: "cashier" },
    { username: "kassir2", password: "2222", role: "cashier" }
  ];

  for (const u of cashierUsers) {
    const exists = await User.findOne({ tenantId, username: u.username }).lean();
    if (exists) continue;
    await User.create({
      tenantId,
      username: u.username,
      passwordHash: bcrypt.hashSync(u.password, 10),
      role: u.role
    });
  }
}

async function main() {
  await mongoose.connect(mongoUri);
  const tenantSlug = String(process.env.DEFAULT_TENANT_SLUG || "default").trim().toLowerCase();
  let tenant = await Tenant.findOne({ slug: tenantSlug }).lean();
  if (!tenant) {
    tenant = await Tenant.create({ name: "Default Tenant", slug: tenantSlug, isActive: true });
  }
  const tenantId = tenant._id;

  await Promise.all([
    Product.deleteMany({ tenantId }),
    Purchase.deleteMany({ tenantId }),
    SupplierPayment.deleteMany({ tenantId }),
    Expense.deleteMany({ tenantId }),
    Category.deleteMany({ tenantId }),
    Supplier.deleteMany({ tenantId })
  ]);

  await ensureCashierUsers(tenantId);

  const categories = await Category.insertMany(categoriesData.map((name) => ({ tenantId, name })));
  const suppliers = await Supplier.insertMany(suppliersData.map((s) => ({ ...s, tenantId })));
  const categoryMap = new Map(categories.map((c) => [c.name, c]));
  const supplierMap = new Map(suppliers.map((s) => [s.name, s]));

  const createdProducts = [];
  const createdPurchases = [];
  let dayOffset = 0;

  for (const item of productsData) {
    const category = categoryMap.get(item.category);
    const supplier = supplierMap.get(item.supplier);
    const totalPurchaseCost = item.quantity * item.purchasePrice;
    const paidAmount = item.paymentType === "naqd"
      ? totalPurchaseCost
      : item.paymentType === "qarz"
        ? 0
        : Math.min(totalPurchaseCost, Number(item.paidAmount || 0));
    const debtAmount = Math.max(0, totalPurchaseCost - paidAmount);
    const purchasedAt = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
    dayOffset += 1;

    const product = await Product.create({
      tenantId,
      name: item.name,
      model: item.model,
      categoryId: category._id,
      supplierId: supplier._id,
      purchasePrice: item.purchasePrice,
      totalPurchaseCost,
      retailPrice: item.retailPrice,
      wholesalePrice: item.wholesalePrice,
      paymentType: item.paymentType,
      paidAmount,
      debtAmount,
      quantity: item.quantity,
      unit: item.unit,
      allowPieceSale: Boolean(item.allowPieceSale),
      pieceUnit: item.pieceUnit || "kg",
      pieceQtyPerBase: item.pieceQtyPerBase || 0,
      piecePrice: item.piecePrice || 0
    });

    const purchase = await Purchase.create({
      tenantId,
      entryType: "initial",
      supplierId: supplier._id,
      productId: product._id,
      productName: product.name,
      productModel: product.model,
      quantity: product.quantity,
      unit: product.unit,
      purchasePrice: product.purchasePrice,
      totalCost: totalPurchaseCost,
      paidAmount,
      debtAmount,
      paymentType: item.paymentType,
      pricingMode: "replace_all",
      purchasedAt
    });

    createdProducts.push(product);
    createdPurchases.push(purchase);
  }

  const baraka = suppliers.find((s) => s.name === "Baraka Trade");
  if (baraka) {
    const debtPurchases = await Purchase.find({
      tenantId,
      supplierId: baraka._id,
      debtAmount: { $gt: 0 }
    }).sort({ purchasedAt: 1 });

    let payRemaining = 450000;
    const allocations = [];
    for (const p of debtPurchases) {
      if (payRemaining <= 0) break;
      const applied = Math.min(payRemaining, p.debtAmount);
      if (applied <= 0) continue;
      p.debtAmount -= applied;
      p.paidAmount += applied;
      p.paymentType = p.debtAmount > 0 ? "qisman" : "naqd";
      await p.save();

      allocations.push({
        purchaseId: p._id,
        productName: p.productName,
        productModel: p.productModel,
        appliedAmount: applied
      });
      payRemaining -= applied;
    }

    const paidAmount = allocations.reduce((sum, a) => sum + a.appliedAmount, 0);
    if (paidAmount > 0) {
      await SupplierPayment.create({
        tenantId,
        supplierId: baraka._id,
        amount: paidAmount,
        note: "Demo to'lov: qarzdan qisman yopildi",
        allocations,
        paidAt: new Date()
      });
    }
  }

  await Expense.insertMany(expensesData.map((e) => ({ ...e, tenantId })));

  const [categoryCount, supplierCount, productCount, purchaseCount, paymentCount, expenseCount] = await Promise.all([
    Category.countDocuments({ tenantId }),
    Supplier.countDocuments({ tenantId }),
    Product.countDocuments({ tenantId }),
    Purchase.countDocuments({ tenantId }),
    SupplierPayment.countDocuments({ tenantId }),
    Expense.countDocuments({ tenantId })
  ]);

  const supplierStats = await Purchase.aggregate([
    { $match: { tenantId } },
    {
      $group: {
        _id: "$supplierId",
        totalCost: { $sum: "$totalCost" },
        totalPaid: { $sum: "$paidAmount" },
        totalDebt: { $sum: "$debtAmount" }
      }
    }
  ]);
  const supplierNames = new Map(suppliers.map((s) => [String(s._id), s.name]));

  console.log("Seed completed");
  console.log({ categoryCount, supplierCount, productCount, purchaseCount, paymentCount, expenseCount });
  console.log("Supplier debt snapshot:");
  for (const row of supplierStats) {
    console.log(`- ${supplierNames.get(String(row._id))}: jami=${row.totalCost}, to'langan=${row.totalPaid}, qarz=${row.totalDebt}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});
