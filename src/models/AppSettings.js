import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true, index: true },
    lowStockThreshold: { type: Number, required: true, min: 0, default: 5 },
    usdRate: { type: Number, required: true, min: 1, default: 12171 },
    displayCurrency: { type: String, enum: ["uzs", "usd"], required: true, default: "uzs" },
    keyboardEnabled: { type: Boolean, required: true, default: true },
    ustalarEnabled: { type: Boolean, required: true, default: false },
<<<<<<< HEAD
    posCompactMode: { type: Boolean, required: true, default: false },
    variantInsightsEnabled: { type: Boolean, required: true, default: false },
    topProductIds: {
      type: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      }],
      default: []
    },
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
    },
    barcodeLabel: {
      paperSize: { type: String, enum: ["58x40", "60x40", "70x50", "80x50"], default: "58x40" },
      orientation: { type: String, enum: ["portrait", "landscape"], default: "portrait" },
      copies: { type: Number, min: 1, default: 1 },
      fields: {
        showName: { type: Boolean, default: true },
        showBarcode: { type: Boolean, default: true },
        showPrice: { type: Boolean, default: true },
        showModel: { type: Boolean, default: true },
        showCategory: { type: Boolean, default: false }
      }
    }
  },
  { timestamps: true }
);

export const AppSettings = mongoose.model("AppSettings", appSettingsSchema);
=======
    receipt: {
      title: { type: String, trim: true, default: "CHEK" },
      footer: { type: String, trim: true, default: "Xaridingiz uchun rahmat!" },
      phoneNumber: { type: String, trim: true, default: "" },
      legalText: {
        type: String,
        trim: true,
        default:
          "Hurmatli xaridor!\nMaxsulotni ilk holatdagi korinishi va qadogi buzulmagan muhri va yorliqlari mavjud bolsa 1 hafta ichida almashtirish huquqiga egasz.\nAlmashtirishda mahsulot yorligi hamda xarid cheki talab qilinadi.\nOyinchoqlar, aksessuarlar (surgich butilka), ichkiyimlar, suzish kiyimlari, chaqaloqlar kiyimlari gigiyenik nuqtai nazardan almashtirib berilmaydi.",
      },
      logoUrl: { type: String, trim: true, default: "" },
      fields: {
        showLogo: { type: Boolean, default: true },
        showTitle: { type: Boolean, default: true },
        showReceiptNumber: { type: Boolean, default: true },
        showDate: { type: Boolean, default: true },
        showTime: { type: Boolean, default: true },
        showType: { type: Boolean, default: false },
        showShift: { type: Boolean, default: true },
        showCashier: { type: Boolean, default: true },
        showPaymentType: { type: Boolean, default: true },
        showCustomer: { type: Boolean, default: true },
        showItemsTable: { type: Boolean, default: true },
        showItemUnitPrice: { type: Boolean, default: true },
        showItemLineTotal: { type: Boolean, default: true },
        showTotal: { type: Boolean, default: true },
        showFooter: { type: Boolean, default: true },
        showLegalText: { type: Boolean, default: true },
        showPhoneNumber: { type: Boolean, default: true },
        showContactLine: { type: Boolean, default: false }
      }
    }
  },
  { timestamps: true }
);

export const AppSettings = mongoose.model("AppSettings", appSettingsSchema);
>>>>>>> b87c25050512a2ade573d01e46a21ed576558824
