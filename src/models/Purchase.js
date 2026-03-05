import mongoose from "mongoose";

const purchaseSchema = new mongoose.Schema(
  {
    entryType: { type: String, enum: ["initial", "restock"], default: "initial" },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    productModel: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true },
    purchasePrice: { type: Number, required: true, min: 0 },
    priceCurrency: { type: String, enum: ["uzs", "usd"], default: "uzs" },
    usdRateUsed: { type: Number, required: true, min: 1, default: 12171 },
    totalCost: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    debtAmount: { type: Number, required: true, min: 0, default: 0 },
    paymentType: { type: String, enum: ["naqd", "qarz", "qisman"], required: true },
    pricingMode: { type: String, enum: ["keep_old", "replace_all", "average"], default: "keep_old" },
    purchasedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

purchaseSchema.index({ supplierId: 1, purchasedAt: -1 });

export const Purchase = mongoose.model("Purchase", purchaseSchema);
