import mongoose from "mongoose";

const saleItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    productModel: { type: String, default: "", trim: true },
    categoryName: { type: String, default: "", trim: true },
    barcode: { type: String, default: "", trim: true },
    productCode: { type: String, default: "", trim: true },
    unit: { type: String, required: true, trim: true },
    variantSize: { type: String, default: "", trim: true },
    variantColor: { type: String, default: "", trim: true },
    quantity: { type: Number, required: true, min: 0 },
    baseQuantity: { type: Number, min: 0, default: 0 },
    stockPerUnitInBase: { type: Number, min: 0, default: 1 },
    returnedQuantity: { type: Number, required: true, min: 0, default: 0 },
    priceType: { type: String, enum: ["retail", "wholesale"], default: "retail" },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    returnedTotal: { type: Number, required: true, min: 0, default: 0 },
    costPrice: { type: Number, required: true, min: 0, default: 0 },
    lineProfit: { type: Number, required: true, default: 0 },
    returnedProfit: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const saleReturnItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    barcode: { type: String, default: "", trim: true },
    productCode: { type: String, default: "", trim: true },
    unit: { type: String, required: true, trim: true },
    variantSize: { type: String, default: "", trim: true },
    variantColor: { type: String, default: "", trim: true },
    quantity: { type: Number, required: true, min: 0 },
    baseQuantity: { type: Number, min: 0, default: 0 },
    stockPerUnitInBase: { type: Number, min: 0, default: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    lineProfit: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const saleReturnSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cashierUsername: { type: String, required: true, trim: true },
    paymentType: { type: String, enum: ["cash", "card", "click", "mixed", "debt"], required: true },
    payments: {
      cash: { type: Number, required: true, min: 0, default: 0 },
      card: { type: Number, required: true, min: 0, default: 0 },
      click: { type: Number, required: true, min: 0, default: 0 }
    },
    totalAmount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, default: "" },
    items: { type: [saleReturnItemSchema], required: true, default: [] }
  },
  { timestamps: true }
);

const saleSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cashierUsername: { type: String, required: true, trim: true },
    saleNumber: { type: Number, min: 1, default: null },
    entryType: { type: String, enum: ["sale", "opening_balance"], required: true, default: "sale" },
    items: { type: [saleItemSchema], required: true, default: [] },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentType: { type: String, enum: ["cash", "card", "click", "mixed", "debt"], required: true },
    payments: {
      cash: { type: Number, required: true, min: 0, default: 0 },
      card: { type: Number, required: true, min: 0, default: 0 },
      click: { type: Number, required: true, min: 0, default: 0 }
    },
    returnedAmount: { type: Number, required: true, min: 0, default: 0 },
    returnedPayments: {
      cash: { type: Number, required: true, min: 0, default: 0 },
      card: { type: Number, required: true, min: 0, default: 0 },
      click: { type: Number, required: true, min: 0, default: 0 }
    },
    returns: { type: [saleReturnSchema], required: true, default: [] },
    note: { type: String, trim: true, default: "" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    customerName: { type: String, trim: true, default: "" },
    customerPhone: { type: String, trim: true, default: "" },
    customerAddress: { type: String, trim: true, default: "" },
    masterId: { type: mongoose.Schema.Types.ObjectId, ref: "Master", default: null },
    masterName: { type: String, trim: true, default: "" },
    masterPhone: { type: String, trim: true, default: "" },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, default: null },
    vehiclePlate: { type: String, trim: true, default: "" },
    vehicleModel: { type: String, trim: true, default: "" },
    debtAmount: { type: Number, required: true, min: 0, default: 0 },
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift", default: null, index: true },
    shiftNumber: { type: Number, min: 1, default: null },
    shiftOpenedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

saleSchema.index({ tenantId: 1, createdAt: -1 });
saleSchema.index({ tenantId: 1, saleNumber: 1 }, { unique: true, sparse: true });

saleSchema.pre("validate", function propagateTenantId(next) {
  if (this.tenantId && Array.isArray(this.returns) && this.returns.length > 0) {
    for (const ret of this.returns) {
      if (ret && !ret.tenantId) {
        ret.tenantId = this.tenantId;
      }
    }
  }
  next();
});

export const Sale = mongoose.model("Sale", saleSchema);
