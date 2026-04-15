import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true },
    spentAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

expenseSchema.index({ tenantId: 1, spentAt: -1 });

export const Expense = mongoose.model("Expense", expenseSchema);
