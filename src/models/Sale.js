import mongoose from "mongoose";

const saleItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    productModel: { type: String, default: "", trim: true },
    unit: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    returnedQuantity: { type: Number, required: true, min: 0, default: 0 },
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
    unit: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    lineProfit: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const saleReturnSchema = new mongoose.Schema(
  {
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
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cashierUsername: { type: String, required: true, trim: true },
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
    debtAmount: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true }
);

saleSchema.index({ createdAt: -1 });

export const Sale = mongoose.model("Sale", saleSchema);
