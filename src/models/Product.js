import mongoose from "mongoose";
const PRODUCT_UNITS = ["dona", "kg", "blok", "pachka", "qop", "razmer"];
const PRODUCT_GENDERS = ["", "qiz_bola", "ogil_bola"];

const productVariantSchema = new mongoose.Schema(
  {
    size: { type: String, required: true, trim: true },
    color: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0, default: 0 }
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    barcode: { type: String, required: true, trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    purchasePrice: { type: Number, required: true, min: 0 },
    priceCurrency: { type: String, enum: ["uzs", "usd"], default: "uzs" },
    usdRateUsed: { type: Number, required: true, min: 1, default: 12171 },
    totalPurchaseCost: { type: Number, required: true, min: 0, default: 0 },
    retailPrice: { type: Number, required: true, min: 0 },
    wholesalePrice: { type: Number, required: true, min: 0 },
    paymentType: { type: String, enum: ["naqd", "qarz", "qisman"], default: "naqd" },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    debtAmount: { type: Number, required: true, min: 0, default: 0 },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true, enum: PRODUCT_UNITS },
    gender: { type: String, enum: PRODUCT_GENDERS, default: "" },
    sizeOptions: {
      type: [String],
      default: []
    },
    colorOptions: {
      type: [String],
      default: []
    },
    variantStocks: {
      type: [productVariantSchema],
      default: []
    },
    allowPieceSale: { type: Boolean, default: false },
    pieceUnit: { type: String, trim: true, enum: PRODUCT_UNITS, default: "kg" },
    pieceQtyPerBase: { type: Number, min: 0, default: 0 },
    piecePrice: { type: Number, min: 0, default: 0 }
  },
  { timestamps: true }
);

productSchema.index({ tenantId: 1, categoryId: 1, name: 1, model: 1 }, { unique: true });
productSchema.index({ tenantId: 1, barcode: 1 }, { unique: true });

export const Product = mongoose.model("Product", productSchema);
