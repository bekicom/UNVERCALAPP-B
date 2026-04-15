import mongoose from "mongoose";

const supplierPaymentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: "", trim: true },
    allocations: [
      {
        purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: "Purchase", required: true },
        productName: { type: String, required: true, trim: true },
        productModel: { type: String, required: true, trim: true },
        appliedAmount: { type: Number, required: true, min: 0 }
      }
    ],
    paidAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

supplierPaymentSchema.index({ tenantId: 1, supplierId: 1, paidAt: -1 });

export const SupplierPayment = mongoose.model("SupplierPayment", supplierPaymentSchema);
