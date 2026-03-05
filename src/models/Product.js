import mongoose from "mongoose";
const PRODUCT_UNITS = ["dona", "kg", "blok", "pachka", "qop"];

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    purchasePrice: { type: Number, required: true, min: 0 },
    totalPurchaseCost: { type: Number, required: true, min: 0, default: 0 },
    retailPrice: { type: Number, required: true, min: 0 },
    wholesalePrice: { type: Number, required: true, min: 0 },
    paymentType: { type: String, enum: ["naqd", "qarz", "qisman"], default: "naqd" },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    debtAmount: { type: Number, required: true, min: 0, default: 0 },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true, enum: PRODUCT_UNITS },
    allowPieceSale: { type: Boolean, default: false },
    pieceUnit: { type: String, trim: true, enum: PRODUCT_UNITS, default: "kg" },
    pieceQtyPerBase: { type: Number, min: 0, default: 0 },
    piecePrice: { type: Number, min: 0, default: 0 }
  },
  { timestamps: true }
);

productSchema.index({ categoryId: 1, name: 1, model: 1 });

export const Product = mongoose.model("Product", productSchema);
