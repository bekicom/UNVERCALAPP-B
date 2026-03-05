import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, unique: true },
    address: { type: String, required: true, trim: true },
    totalDebt: { type: Number, required: true, min: 0, default: 0 },
    totalPaid: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true }
);

customerSchema.index({ fullName: 1 });

export const Customer = mongoose.model("Customer", customerSchema);
