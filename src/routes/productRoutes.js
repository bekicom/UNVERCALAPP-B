import { Router } from "express";
import { authMiddleware } from "../authMiddleware.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { Supplier } from "../models/Supplier.js";
import { Purchase } from "../models/Purchase.js";
import { AppSettings } from "../models/AppSettings.js";
import { SyncTransfer } from "../models/SyncTransfer.js";
import { Transfer } from "../models/Transfer.js";
import { tenantFilter, withTenant } from "../tenant.js";

const router = Router();
const PRODUCT_UNITS = ["dona", "kg", "blok", "pachka", "qop", "razmer"];
const PRODUCT_GENDERS = ["", "qiz_bola", "ogil_bola"];
const PRICING_MODES = ["keep_old", "replace_all", "average"];

function getCentralApiBaseUrl() {
  return String(process.env.CENTRAL_API_BASE_URL || "").replace(/\/+$/, "");
}

function getCentralSyncUsername() {
  return String(process.env.CENTRAL_SYNC_USERNAME || "").trim();
}

function getCentralSyncPassword() {
  return String(process.env.CENTRAL_SYNC_PASSWORD || "").trim();
}

function getDefaultStoreCode() {
  return String(process.env.STORE_CODE || "").trim();
}

function getDefaultStoreName() {
  return String(process.env.STORE_NAME || "").trim().toLowerCase();
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeBarcode(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function generateBarcodeCandidate() {
  const base = String(Date.now()).slice(-10);
  const suffix = String(Math.floor(100 + Math.random() * 900));
  return `${base}${suffix}`;
}

async function ensureUniqueBarcode(tenantId, barcode, excludeId = null) {
  const normalized = normalizeBarcode(barcode);
  if (normalized) {
    const duplicate = await Product.exists({
      tenantId,
      barcode: normalized,
      ...(excludeId ? { _id: { $ne: excludeId } } : {})
    });
    if (duplicate) {
      return { error: "Bu shtixkod allaqachon mavjud" };
    }
    return { barcode: normalized };
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = generateBarcodeCandidate();
    const exists = await Product.exists({
      tenantId,
      barcode: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {})
    });
    if (!exists) {
      return { barcode: candidate };
    }
  }

  return { error: "Shtixkod yaratib bo'lmadi, qayta urinib ko'ring" };
}

async function getUsdRate(tenantId) {
  const settings = await AppSettings.findOne({ tenantId }).lean();
  const rate = Number(settings?.usdRate || 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 12171;
}

function convertToUzs(value, priceCurrency, usdRate) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  if (priceCurrency === "usd") return roundMoney(numeric * usdRate);
  return roundMoney(numeric);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeVariantStocks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      size: String(item?.size || "").trim(),
      color: String(item?.color || "").trim(),
      quantity: Number(item?.quantity)
    }))
    .filter((item) => item.size && item.color && Number.isFinite(item.quantity) && item.quantity >= 0);
}

function mergeVariantStocks(existingStocks, incomingStocks) {
  const bucket = new Map();

  for (const item of normalizeVariantStocks(existingStocks)) {
    const key = `${item.size}::${item.color}`;
    bucket.set(key, {
      size: item.size,
      color: item.color,
      quantity: Number(item.quantity || 0)
    });
  }

  for (const item of normalizeVariantStocks(incomingStocks)) {
    const key = `${item.size}::${item.color}`;
    const current = bucket.get(key) || {
      size: item.size,
      color: item.color,
      quantity: 0
    };
    current.quantity = roundMoney(Number(current.quantity || 0) + Number(item.quantity || 0));
    bucket.set(key, current);
  }

  return [...bucket.values()].filter((item) => Number(item.quantity || 0) > 0);
}

function centralApiUrl(path) {
  const baseUrl = getCentralApiBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalized}`;
}

async function readJsonOrThrow(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text || "Noma'lum xato" };
  }
  if (!response.ok) {
    throw new Error(data?.message || "Markaziy server xatosi");
  }
  return data;
}

async function getCentralToken() {
  const baseUrl = getCentralApiBaseUrl();
  const username = getCentralSyncUsername();
  const password = getCentralSyncPassword();

  if (!baseUrl || !username || !password) {
    throw new Error("Markaziy sinxron sozlamalari to'liq emas");
  }

  const response = await fetch(centralApiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password
    })
  });

  const data = await readJsonOrThrow(response);
  if (!data?.token) {
    throw new Error("Markaziy server token qaytarmadi");
  }
  return data.token;
}

async function fetchCentralTransfers(token) {
  const response = await fetch(centralApiUrl("/transfers"), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readJsonOrThrow(response);
  return Array.isArray(data?.transfers) ? data.transfers : [];
}

async function fetchCentralProductByBarcode(token, barcode) {
  const response = await fetch(
    `${centralApiUrl("/products")}?q=${encodeURIComponent(barcode)}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  const data = await readJsonOrThrow(response);
  const products = Array.isArray(data?.products) ? data.products : [];
  return products.find((item) => String(item?.barcode || "").trim() === barcode) || null;
}

async function ensureCategoryByName(req, categoryName) {
  const safeName = String(categoryName || "").trim() || "Sinxron kategoriya";
  let category = await Category.findOne(tenantFilter(req, { name: safeName }));
  if (!category) {
    category = await Category.create(withTenant(req, { name: safeName }));
  }
  return category;
}

async function ensureSupplierByName(req, supplierName) {
  const safeName = String(supplierName || "").trim() || "Sklad transfer";
  let supplier = await Supplier.findOne(tenantFilter(req, { name: safeName }));
  if (!supplier) {
    supplier = await Supplier.create(withTenant(req, {
      name: safeName,
      address: "Sklad transfer",
      phone: ""
    }));
  }
  return supplier;
}

function supportsPieceSale(unit) {
  return unit === "qop" || unit === "pachka";
}

function parsePayload(body, usdRate) {
  const allowPieceSale = Boolean(body?.allowPieceSale);
  const paymentType = String(body?.paymentType || "naqd").toLowerCase();
  const priceCurrency = String(body?.priceCurrency || "uzs").toLowerCase();
  const unit = String(body?.unit || "").trim().toLowerCase();
  const gender = String(body?.gender || "").trim().toLowerCase();
  const sizeOptions = normalizeStringArray(body?.sizeOptions);
  const colorOptions = normalizeStringArray(body?.colorOptions);
  const variantStocks = normalizeVariantStocks(body?.variantStocks);
  const quantity = unit === "razmer"
    ? variantStocks.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    : Number(body?.quantity);
  const purchasePrice = convertToUzs(body?.purchasePrice, priceCurrency, usdRate);
  const totalPurchaseCost = roundMoney(quantity * purchasePrice);
  const rawPaid = convertToUzs(body?.paidAmount, priceCurrency, usdRate);
  const paidAmount = paymentType === "naqd"
    ? totalPurchaseCost
    : paymentType === "qarz"
      ? 0
      : rawPaid;
  const debtAmount = Math.max(0, totalPurchaseCost - (Number.isNaN(paidAmount) ? 0 : paidAmount));

  return {
    name: String(body?.name || "").trim(),
    model: String(body?.model || "").trim(),
    barcode: normalizeBarcode(body?.barcode),
    categoryId: String(body?.categoryId || "").trim(),
    supplierId: String(body?.supplierId || "").trim(),
    purchasePrice,
    priceCurrency,
    usdRateUsed: usdRate,
    totalPurchaseCost: Number.isFinite(totalPurchaseCost) ? totalPurchaseCost : 0,
    retailPrice: convertToUzs(body?.retailPrice, priceCurrency, usdRate),
    wholesalePrice: convertToUzs(body?.wholesalePrice, priceCurrency, usdRate),
    paymentType,
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
    debtAmount,
    quantity,
    unit,
    gender,
    sizeOptions,
    colorOptions,
    variantStocks,
    allowPieceSale: supportsPieceSale(unit) ? allowPieceSale : false,
    pieceUnit: String(body?.pieceUnit || (unit === "pachka" ? "dona" : "kg")).trim().toLowerCase(),
    pieceQtyPerBase: Number(body?.pieceQtyPerBase),
    piecePrice: convertToUzs(body?.piecePrice, priceCurrency, usdRate)
  };
}

function validatePayload(payload) {
  if (!payload.name || !payload.model || !payload.unit || !payload.categoryId || !payload.supplierId) {
    return "Barcha maydonlarni to'ldiring";
  }
  if ([payload.purchasePrice, payload.retailPrice, payload.wholesalePrice, payload.quantity, payload.paidAmount].some((n) => Number.isNaN(n) || n < 0)) {
    return "Narx va miqdor manfiy bo'lmasligi kerak";
  }
  if (!["uzs", "usd"].includes(payload.priceCurrency)) return "Valyuta noto'g'ri";
  if (!["naqd", "qarz", "qisman"].includes(payload.paymentType)) return "To'lov turi noto'g'ri";
  if (!PRODUCT_GENDERS.includes(payload.gender)) return "Jinsi noto'g'ri";
  if (payload.paidAmount > payload.totalPurchaseCost) return "To'langan summa umumiy summadan katta bo'lmasin";
  if (!PRODUCT_UNITS.includes(payload.unit)) {
    return "Birlik faqat: dona, kg, blok, pachka, qop, razmer";
  }
  if (payload.unit === "razmer") {
    if (!payload.sizeOptions.length) return "Kamida bitta razmer tanlang";
    if (!payload.colorOptions.length) return "Kamida bitta rang tanlang";
    if (!payload.variantStocks.length) return "Razmer va rang qoldiqlarini kiriting";
    for (const item of payload.variantStocks) {
      if (!payload.sizeOptions.includes(item.size)) {
        return "Variantdagi razmer noto'g'ri";
      }
      if (!payload.colorOptions.includes(item.color)) {
        return "Variantdagi rang noto'g'ri";
      }
    }
  }
  if (payload.allowPieceSale) {
    if (!PRODUCT_UNITS.includes(payload.pieceUnit)) {
      return "Parcha birlik noto'g'ri";
    }
    if (
      Number.isNaN(payload.pieceQtyPerBase) ||
      payload.pieceQtyPerBase <= 0 ||
      Number.isNaN(payload.piecePrice) ||
      payload.piecePrice <= 0
    ) {
      return "Parcha sotuv uchun miqdor va narx 0 dan katta bo'lishi kerak";
    }
  }
  return null;
}

async function getOrCreateProductSettings(tenantId) {
  let settings = await AppSettings.findOne({ tenantId });
  if (!settings) {
    settings = await AppSettings.create({ tenantId, topProductIds: [] });
  } else if (!Array.isArray(settings.topProductIds)) {
    settings.topProductIds = [];
    await settings.save();
  }
  return settings;
}

router.get("/", authMiddleware, async (req, res) => {
  const query = tenantFilter(req);
  if (req.query.categoryId) {
    query.categoryId = req.query.categoryId;
  }
  const search = String(req.query.q || "").trim();
  if (search) {
    const normalized = normalizeBarcode(search);
    query.$or = [
      { barcode: normalized },
      { name: { $regex: search, $options: "i" } },
      { model: { $regex: search, $options: "i" } }
    ];
  }

  const products = await Product.find(query)
    .populate({ path: "categoryId", select: "name" })
    .populate({ path: "supplierId", select: "name phone address" })
    .sort(search ? { quantity: -1, createdAt: -1 } : { createdAt: -1 })
    .limit(search ? 20 : 0)
    .lean();
  res.json({ products });
});

router.get("/top", authMiddleware, async (req, res) => {
  const settings = await getOrCreateProductSettings(req.user.tenantId);
  const ids = (settings.topProductIds || []).map((item) => String(item));
  if (!ids.length) {
    return res.json({ products: [] });
  }

  const products = await Product.find({
    tenantId: req.user.tenantId,
    _id: { $in: ids }
  })
    .populate({ path: "categoryId", select: "name" })
    .populate({ path: "supplierId", select: "name phone address" })
    .lean();

  const ordered = ids
    .map((id) => products.find((product) => String(product._id) === id))
    .filter(Boolean);

  res.json({ products: ordered });
});

router.put("/top", authMiddleware, async (req, res) => {
  const productIdsRaw = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
  const productIds = [...new Set(productIdsRaw.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 24);

  if (productIds.length) {
    const matchedProducts = await Product.countDocuments({
      tenantId: req.user.tenantId,
      _id: { $in: productIds }
    });
    if (matchedProducts !== productIds.length) {
      return res.status(400).json({ message: "TOP mahsulotlardan biri topilmadi" });
    }
  }

  const settings = await getOrCreateProductSettings(req.user.tenantId);
  settings.topProductIds = productIds;
  await settings.save();

  const products = await Product.find({
    tenantId: req.user.tenantId,
    _id: { $in: productIds }
  })
    .populate({ path: "categoryId", select: "name" })
    .populate({ path: "supplierId", select: "name phone address" })
    .lean();

  const ordered = productIds
    .map((id) => products.find((product) => String(product._id) === id))
    .filter(Boolean);

  res.json({ products: ordered });
});

router.post("/sync-central", authMiddleware, async (req, res) => {
  const storeCode = String(req.body?.storeCode || getDefaultStoreCode()).trim();
  const storeName = String(req.body?.storeName || getDefaultStoreName()).trim().toLowerCase();
  if (!storeCode && !storeName) {
    return res.status(400).json({ message: "Do'kon kodi yoki nomi kiritilmagan" });
  }

  const centralToken = await getCentralToken();
  const transfers = await fetchCentralTransfers(centralToken);
  const storeTransfers = transfers.filter(
    (item) =>
      String(item?.status || "").trim().toLowerCase() === "sent" &&
      (
        (storeCode.length > 0 && String(item?.storeCode || "").trim() === storeCode) ||
        (storeName.length > 0 && String(item?.storeName || "").trim().toLowerCase() === storeName)
      )
  );

  if (!storeTransfers.length) {
    return res.json({
      syncedTransfers: 0,
      syncedProducts: 0,
      skippedTransfers: 0,
      message: "Sinxron uchun yangi transfer topilmadi"
    });
  }

  const existingLogs = await SyncTransfer.find({
    tenantId: req.user.tenantId,
    remoteTransferId: { $in: storeTransfers.map((item) => String(item?._id || "")) }
  }).lean();
  const existingIds = new Set(existingLogs.map((item) => String(item.remoteTransferId)));
  const pendingTransfers = storeTransfers.filter((item) => !existingIds.has(String(item?._id || "")));

  if (!pendingTransfers.length) {
    return res.json({
      syncedTransfers: 0,
      syncedProducts: 0,
      skippedTransfers: storeTransfers.length,
      message: "Barcha transferlar oldin sinxron qilingan"
    });
  }

  const allBarcodes = [
    ...new Set(
      pendingTransfers.flatMap((transfer) =>
        (Array.isArray(transfer?.items) ? transfer.items : [])
          .map((item) => String(item?.barcode || "").trim())
          .filter(Boolean)
      )
    )
  ];

  const remoteProductsMap = new Map();
  for (const barcode of allBarcodes) {
    const remoteProduct = await fetchCentralProductByBarcode(centralToken, barcode);
    if (remoteProduct) {
      remoteProductsMap.set(barcode, remoteProduct);
    }
  }

  let syncedTransfers = 0;
  let syncedProducts = 0;

  for (const transfer of pendingTransfers) {
    const transferItems = Array.isArray(transfer?.items) ? transfer.items : [];

    for (const rawItem of transferItems) {
      const barcode = String(rawItem?.barcode || "").trim();
      const remoteProduct = remoteProductsMap.get(barcode);
      const category = await ensureCategoryByName(
        req,
        remoteProduct?.categoryId?.name || "Sinxron kategoriya"
      );
      const supplier = await ensureSupplierByName(
        req,
        remoteProduct?.supplierId?.name || "Sklad transfer"
      );

      const incomingQuantity = Number(rawItem?.quantity || 0);
      if (!Number.isFinite(incomingQuantity) || incomingQuantity <= 0) {
        continue;
      }

      const unit = String(
        remoteProduct?.unit || rawItem?.unit || "dona"
      ).trim().toLowerCase();
      const purchasePrice = roundMoney(
        Number(rawItem?.purchasePrice ?? remoteProduct?.purchasePrice ?? 0)
      );
      const retailPrice = roundMoney(
        Number(remoteProduct?.retailPrice ?? purchasePrice)
      );
      const wholesalePrice = roundMoney(
        Number(remoteProduct?.wholesalePrice ?? retailPrice)
      );
      const sizeOptions = normalizeStringArray(remoteProduct?.sizeOptions);
      const colorOptions = normalizeStringArray(remoteProduct?.colorOptions);
      const remoteVariantStocks = normalizeVariantStocks(remoteProduct?.variantStocks);
      const transferredVariantStocks = normalizeVariantStocks(
        rawItem?.variants || rawItem?.variantStocks
      );
      const effectiveVariantStocks = transferredVariantStocks.length
        ? transferredVariantStocks
        : remoteVariantStocks;
      const effectiveSizeOptions = normalizeStringArray([
        ...sizeOptions,
        ...effectiveVariantStocks.map((item) => item.size)
      ]);
      const effectiveColorOptions = normalizeStringArray([
        ...colorOptions,
        ...effectiveVariantStocks.map((item) => item.color)
      ]);

      let product = await Product.findOne(
        tenantFilter(req, { barcode: barcode || "__missing__" })
      );

      if (!product) {
        product = await Product.create(withTenant(req, {
          name: String(remoteProduct?.name || rawItem?.name || "Transfer mahsulot").trim(),
          model: String(remoteProduct?.model || rawItem?.model || "-").trim(),
          barcode: barcode || generateBarcodeCandidate(),
          categoryId: category._id,
          supplierId: supplier._id,
          purchasePrice,
          priceCurrency: "uzs",
          usdRateUsed: Number(remoteProduct?.usdRateUsed || 12171) || 12171,
          totalPurchaseCost: roundMoney(purchasePrice * incomingQuantity),
          retailPrice,
          wholesalePrice,
          paymentType: "naqd",
          paidAmount: roundMoney(purchasePrice * incomingQuantity),
          debtAmount: 0,
          quantity: incomingQuantity,
          unit: PRODUCT_UNITS.includes(unit) ? unit : "dona",
          gender: String(remoteProduct?.gender || "").trim().toLowerCase(),
          sizeOptions: effectiveSizeOptions,
          colorOptions: effectiveColorOptions,
          variantStocks: effectiveVariantStocks,
          allowPieceSale: Boolean(remoteProduct?.allowPieceSale),
          pieceUnit: String(remoteProduct?.pieceUnit || "kg").trim().toLowerCase(),
          pieceQtyPerBase: Number(remoteProduct?.pieceQtyPerBase || 0),
          piecePrice: Number(remoteProduct?.piecePrice || 0)
        }));
      } else {
        product.name = String(remoteProduct?.name || rawItem?.name || product.name).trim();
        product.model = String(remoteProduct?.model || rawItem?.model || product.model).trim();
        product.categoryId = category._id;
        product.supplierId = supplier._id;
        product.purchasePrice = purchasePrice;
        product.retailPrice = retailPrice;
        product.wholesalePrice = wholesalePrice;
        product.priceCurrency = "uzs";
        product.usdRateUsed = Number(remoteProduct?.usdRateUsed || product.usdRateUsed || 12171) || 12171;
        product.quantity = roundMoney(Number(product.quantity || 0) + incomingQuantity);
        product.totalPurchaseCost = roundMoney(purchasePrice * incomingQuantity);
        product.paymentType = "naqd";
        product.paidAmount = roundMoney(purchasePrice * incomingQuantity);
        product.debtAmount = 0;
        if (PRODUCT_UNITS.includes(unit)) {
          product.unit = unit;
        }
        if (PRODUCT_GENDERS.includes(String(remoteProduct?.gender || "").trim().toLowerCase())) {
          product.gender = String(remoteProduct?.gender || "").trim().toLowerCase();
        }
        if (effectiveSizeOptions.length) {
          product.sizeOptions = effectiveSizeOptions;
        }
        if (effectiveColorOptions.length) {
          product.colorOptions = effectiveColorOptions;
        }
        if (effectiveVariantStocks.length) {
          product.variantStocks = mergeVariantStocks(
            product.variantStocks,
            effectiveVariantStocks
          );
        }
        product.allowPieceSale = Boolean(remoteProduct?.allowPieceSale);
        product.pieceUnit = String(remoteProduct?.pieceUnit || product.pieceUnit || "kg")
          .trim()
          .toLowerCase();
        product.pieceQtyPerBase = Number(remoteProduct?.pieceQtyPerBase || product.pieceQtyPerBase || 0);
        product.piecePrice = Number(remoteProduct?.piecePrice || product.piecePrice || 0);
        await product.save();
      }

      await Purchase.create(withTenant(req, {
        entryType: "restock",
        supplierId: supplier._id,
        productId: product._id,
        productName: product.name,
        productModel: product.model,
        quantity: incomingQuantity,
        unit: product.unit,
        purchasePrice,
        priceCurrency: "uzs",
        usdRateUsed: Number(product.usdRateUsed || 12171) || 12171,
        totalCost: roundMoney(purchasePrice * incomingQuantity),
        paidAmount: roundMoney(purchasePrice * incomingQuantity),
        debtAmount: 0,
        paymentType: "naqd",
        pricingMode: "replace_all"
      }));
      syncedProducts += 1;
    }

    await SyncTransfer.create(withTenant(req, {
      remoteTransferId: String(transfer?._id || ""),
      remoteTransferNumber: String(transfer?.transferNumber || ""),
      storeCode: storeCode || String(transfer?.storeCode || storeName),
      syncedAt: new Date(),
      itemCount: transferItems.length
    }));
    syncedTransfers += 1;
  }

  return res.json({
    syncedTransfers,
    syncedProducts,
    skippedTransfers: storeTransfers.length - pendingTransfers.length,
    message: `${syncedTransfers} ta transfer sinxron qilindi`
  });
});

router.post("/", authMiddleware, async (req, res) => {
  const usdRate = await getUsdRate(req.user.tenantId);
  const payload = parsePayload(req.body, usdRate);
  const invalid = validatePayload(payload);
  if (invalid) return res.status(400).json({ message: invalid });
  const barcodeResult = await ensureUniqueBarcode(req.user.tenantId, payload.barcode);
  if (barcodeResult.error) return res.status(409).json({ message: barcodeResult.error });
  payload.barcode = barcodeResult.barcode;

  const categoryExists = await Category.exists(tenantFilter(req, { _id: payload.categoryId }));
  if (!categoryExists) return res.status(400).json({ message: "Kategoriya topilmadi" });
  const supplierExists = await Supplier.exists(tenantFilter(req, { _id: payload.supplierId }));
  if (!supplierExists) return res.status(400).json({ message: "Yetkazib beruvchi topilmadi" });

  const exists = await Product.exists(tenantFilter(req, { name: payload.name, model: payload.model, categoryId: payload.categoryId }));
  if (exists) return res.status(409).json({ message: "Bu mahsulot allaqachon mavjud" });

  const product = await Product.create(withTenant(req, payload));
  await Purchase.create(withTenant(req, {
    entryType: "initial",
    supplierId: payload.supplierId,
    productId: product._id,
    productName: payload.name,
    productModel: payload.model,
    quantity: payload.quantity,
    unit: payload.unit,
    purchasePrice: payload.purchasePrice,
    priceCurrency: payload.priceCurrency,
    usdRateUsed: payload.usdRateUsed,
    totalCost: payload.totalPurchaseCost,
    paidAmount: payload.paidAmount,
    debtAmount: payload.debtAmount,
    paymentType: payload.paymentType,
    pricingMode: "replace_all"
  }));
  res.status(201).json({ product });
});

router.post("/:id/restock", authMiddleware, async (req, res) => {
  const product = await Product.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!product) return res.status(404).json({ message: "Mahsulot topilmadi" });

  const supplierId = String(req.body?.supplierId || "").trim();
  const incomingQuantity = Number(req.body?.quantity);
  const purchasePrice = Number(req.body?.purchasePrice);
  const priceCurrency = String(req.body?.priceCurrency || "uzs").toLowerCase();
  const pricingMode = String(req.body?.pricingMode || "keep_old").toLowerCase();
  const paymentType = String(req.body?.paymentType || "naqd").toLowerCase();
  const usdRate = await getUsdRate(req.user.tenantId);
  const purchasePriceUzs = convertToUzs(purchasePrice, priceCurrency, usdRate);
  const retailPriceNew = convertToUzs(req.body?.retailPrice, priceCurrency, usdRate);
  const wholesalePriceNew = convertToUzs(req.body?.wholesalePrice, priceCurrency, usdRate);
  const piecePriceNew = convertToUzs(req.body?.piecePrice, priceCurrency, usdRate);
  const rawPaid = convertToUzs(req.body?.paidAmount, priceCurrency, usdRate);

  if (!supplierId) return res.status(400).json({ message: "Yetkazib beruvchi tanlang" });
  if (!Number.isFinite(incomingQuantity) || incomingQuantity <= 0) {
    return res.status(400).json({ message: "Kirim miqdori 0 dan katta bo'lishi kerak" });
  }
  if (!["uzs", "usd"].includes(priceCurrency)) {
    return res.status(400).json({ message: "Valyuta noto'g'ri" });
  }
  if (!Number.isFinite(purchasePriceUzs) || purchasePriceUzs < 0) {
    return res.status(400).json({ message: "Kelish narxi noto'g'ri" });
  }
  if (!PRICING_MODES.includes(pricingMode)) {
    return res.status(400).json({ message: "Narx strategiyasi noto'g'ri" });
  }
  if (!["naqd", "qarz", "qisman"].includes(paymentType)) {
    return res.status(400).json({ message: "To'lov turi noto'g'ri" });
  }

  const supplierExists = await Supplier.exists(tenantFilter(req, { _id: supplierId }));
  if (!supplierExists) return res.status(400).json({ message: "Yetkazib beruvchi topilmadi" });

  if (pricingMode !== "keep_old") {
    if (!Number.isFinite(retailPriceNew) || retailPriceNew < 0) {
      return res.status(400).json({ message: "Yangi chakana narx noto'g'ri" });
    }
    if (!Number.isFinite(wholesalePriceNew) || wholesalePriceNew < 0) {
      return res.status(400).json({ message: "Yangi optom narx noto'g'ri" });
    }
    if (product.allowPieceSale && (!Number.isFinite(piecePriceNew) || piecePriceNew <= 0)) {
      return res.status(400).json({ message: "Yangi parcha narx noto'g'ri" });
    }
  }

  const incomingTotal = roundMoney(incomingQuantity * purchasePriceUzs);
  const paidAmount = paymentType === "naqd" ? incomingTotal : paymentType === "qarz" ? 0 : rawPaid;
  if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > incomingTotal) {
    return res.status(400).json({ message: "To'langan summa noto'g'ri" });
  }
  const debtAmount = incomingTotal - paidAmount;

  const oldQty = Number(product.quantity) || 0;
  const newQty = oldQty + incomingQuantity;

  const oldRetail = Number(product.retailPrice) || 0;
  const oldWholesale = Number(product.wholesalePrice) || 0;
  const oldPiecePrice = Number(product.piecePrice) || 0;

  let retailPrice = oldRetail;
  let wholesalePrice = oldWholesale;
  let piecePrice = oldPiecePrice;

  if (pricingMode === "replace_all") {
    retailPrice = retailPriceNew;
    wholesalePrice = wholesalePriceNew;
    if (product.allowPieceSale) piecePrice = piecePriceNew;
  } else if (pricingMode === "average") {
    retailPrice = (oldRetail + retailPriceNew) / 2;
    wholesalePrice = (oldWholesale + wholesalePriceNew) / 2;
    if (product.allowPieceSale) piecePrice = (oldPiecePrice + piecePriceNew) / 2;
  }

  const oldCost = Number(product.purchasePrice) || 0;
  const weightedPurchasePrice = newQty > 0
    ? ((oldCost * oldQty) + incomingTotal) / newQty
    : purchasePriceUzs;

  product.quantity = newQty;
  product.purchasePrice = weightedPurchasePrice;
  product.priceCurrency = priceCurrency;
  product.usdRateUsed = usdRate;
  product.totalPurchaseCost = incomingTotal;
  product.retailPrice = retailPrice;
  product.wholesalePrice = wholesalePrice;
  if (product.allowPieceSale) {
    product.piecePrice = piecePrice;
  }
  product.supplierId = supplierId;
  product.paymentType = paymentType;
  product.paidAmount = paidAmount;
  product.debtAmount = debtAmount;

  await product.save();

  await Purchase.create(withTenant(req, {
    entryType: "restock",
    supplierId,
    productId: product._id,
    productName: product.name,
    productModel: product.model,
    quantity: incomingQuantity,
    unit: product.unit,
    purchasePrice: purchasePriceUzs,
    priceCurrency,
    usdRateUsed: usdRate,
    totalCost: incomingTotal,
    paidAmount,
    debtAmount,
    paymentType,
    pricingMode
  }));

  return res.json({ product });
});

router.put("/:id", authMiddleware, async (req, res) => {
  const usdRate = await getUsdRate(req.user.tenantId);
  const payload = parsePayload(req.body, usdRate);
  const invalid = validatePayload(payload);
  if (invalid) return res.status(400).json({ message: invalid });
  const barcodeResult = await ensureUniqueBarcode(
    req.user.tenantId,
    payload.barcode,
    req.params.id
  );
  if (barcodeResult.error) return res.status(409).json({ message: barcodeResult.error });
  payload.barcode = barcodeResult.barcode;

  const categoryExists = await Category.exists(tenantFilter(req, { _id: payload.categoryId }));
  if (!categoryExists) return res.status(400).json({ message: "Kategoriya topilmadi" });
  const supplierExists = await Supplier.exists(tenantFilter(req, { _id: payload.supplierId }));
  if (!supplierExists) return res.status(400).json({ message: "Yetkazib beruvchi topilmadi" });

  const duplicate = await Product.exists(tenantFilter(req, { name: payload.name, model: payload.model, categoryId: payload.categoryId, _id: { $ne: req.params.id } }));
  if (duplicate) return res.status(409).json({ message: "Bu mahsulot allaqachon mavjud" });

  const updated = await Product.findOneAndUpdate(tenantFilter(req, { _id: req.params.id }), payload, { new: true, runValidators: true });
  if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });

  res.json({ product: updated });
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const deleted = await Product.findOneAndDelete(tenantFilter(req, { _id: req.params.id }));
  if (!deleted) return res.status(404).json({ message: "Mahsulot topilmadi" });
  res.json({ ok: true });
});

// Get transfers
router.get("/transfers", authMiddleware, async (req, res) => {
  const { q = "", storeName = "", storeCode = "" } = req.query;
  const filter = tenantFilter(req);

  if (storeCode) {
    filter.storeCode = storeCode;
  }
  if (storeName) {
    filter.storeName = new RegExp(storeName, "i");
  }
  if (q) {
    filter.$or = [
      { transferNumber: new RegExp(q, "i") },
      { storeName: new RegExp(q, "i") },
      { note: new RegExp(q, "i") }
    ];
  }

  const transfers = await Transfer.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ transfers });
});

export default router;
