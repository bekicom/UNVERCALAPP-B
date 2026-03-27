import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true, index: true },
    lowStockThreshold: { type: Number, required: true, min: 0, default: 5 },
    usdRate: { type: Number, required: true, min: 1, default: 12171 },
    displayCurrency: { type: String, enum: ["uzs", "usd"], required: true, default: "uzs" },
    keyboardEnabled: { type: Boolean, required: true, default: true },
    ustalarEnabled: { type: Boolean, required: true, default: false },
    receipt: {
      title: { type: String, trim: true, default: "CHEK" },
      footer: { type: String, trim: true, default: "Xaridingiz uchun rahmat!" },
      logoUrl: { type: String, trim: true, default: "" },
      fields: {
        showDate: { type: Boolean, default: true },
        showCashier: { type: Boolean, default: true },
        showPaymentType: { type: Boolean, default: true },
        showCustomer: { type: Boolean, default: true },
        showItemsTable: { type: Boolean, default: true },
        showItemUnitPrice: { type: Boolean, default: true },
        showItemLineTotal: { type: Boolean, default: true },
        showTotal: { type: Boolean, default: true },
        showFooter: { type: Boolean, default: true }
      }
    }
  },
  { timestamps: true }
);

export const AppSettings = mongoose.model("AppSettings", appSettingsSchema);
