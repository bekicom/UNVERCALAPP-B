import mongoose from "mongoose";

const transferItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  code: { type: String, required: true },
  barcode: { type: String, default: "" },
  unit: { type: String, default: "" },
  quantity: { type: Number, required: true, min: 0 },
  variants: { type: [Object], default: [] },
  purchasePrice: { type: Number, required: true, min: 0 },
  totalValue: { type: Number, required: true, min: 0 }
});

const transferSchema = new mongoose.Schema(
  {
    transferNumber: { type: String, required: true, unique: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store" },
    storeCode: { type: String, required: true },
    storeName: { type: String, required: true },
    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
    items: { type: [transferItemSchema], default: [] },
    totalQuantity: { type: Number, required: true, min: 0 },
    totalValue: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
    sentAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

transferSchema.index({ transferNumber: 1 }, { unique: true });

export const Transfer = mongoose.model("Transfer", transferSchema);