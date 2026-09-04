import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle, Edit3, Eye, FileText, History, Minus, Printer, Trash2 } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { PaymentStatusBadge, PaidStamp, formatPaidDateTime } from "../../components/PaymentStatus";
import { ActionsGroup } from "../../components/ActionsGroup";
import {
  OpBillingHeader,
  PatientDoctorBanner,
  BookedAppointmentField,
  MiddleToolbarRow,
  PaymentModeDiscountRow,
  ChargesBreakdownTable,
  ThreeButtonActionBar,
} from "../../components/OpBillingUi";
import { parseList, requestJson } from "../receptionApi";
import { getReceptionistProfile } from "../receptionSession";
import { getNurseProfile } from "../../Nurse/nurseSession";
import { canUseModulePermission, useRolePermissionsSync } from "../../utils/rolePermissions";
import {
  belongsToReceptionistScope,
  getReceptionistScope,
  scopeReceptionistRecords,
} from "../receptionScope";
import { useToast } from "../../components/ToastProvider";
import {
  onlyNumberValue,
  validateNumeric,
  validateSelected,
} from "../../utils/validation";
import { formatIndianCurrency } from "../../utils/format";
import { getClinicDisplayName } from "../../utils/clinicDisplay";
import { getClinicInvoiceBranding } from "../../utils/clinicBranding";
import { getCachedLabMasterTests, normalizeLabTests } from "../../utils/labMaster";
import { clearPendingDiagnosticRequest, getPendingDiagnosticRequest } from "../../utils/diagnosticRequests";
import { RECEPTION_RECENT_SERVICE_BILLS_KEY as RECENT_SERVICE_BILLS_STORAGE_KEY } from "../../utils/billingRevenue";
import { BILLING_API_PATHS, getBillingApiPath } from "../../config/api";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "" && value !== 0);

const formatAmountInput = (value, { emptyValue = "0.00" } = {}) => {
  if (value === "" || value === undefined || value === null) return emptyValue;

  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : emptyValue;
};

const formatCurrency = (value) => formatIndianCurrency(value);
const amountFormat = (value) => (Number(value) || 0).toFixed(2);
const LAST_INVOICE_STORAGE_KEY = "receptionLatestInvoice";
const HALF_GST_RATE = 0.09;

const getTodayKey = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const normalizeDateKey = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
};

const createInvoiceNo = (prefix) =>
  `${prefix}-${Date.now()}-${String(Math.floor(Math.random() * 900) + 100)}`;


const AMOUNT_KEYS = {
  consultation: [
    "consultationCharge",
    "ConsultationCharge",
    "consultationCharges",
    "ConsultationCharges",
    "consultationFee",
    "ConsultationFee",
    "doctorFee",
    "DoctorFee",
  ],
  medicine: [
    "medicineCharge",
    "MedicineCharge",
    "medicineCharges",
    "MedicineCharges",
    "medicineAmount",
    "MedicineAmount",
    "medicineFee",
    "MedicineFee",
    "medicationCharge",
    "MedicationCharge",
    "medicationCharges",
    "MedicationCharges",
    "medicationAmount",
    "MedicationAmount",
    "pharmacyCharge",
    "PharmacyCharge",
    "pharmacyCharges",
    "PharmacyCharges",
    "pharmacyAmount",
    "PharmacyAmount",
  ],
  lab: [
    "labCharge",
    "LabCharge",
    "labCharges",
    "LabCharges",
    "labAmount",
    "LabAmount",
    "laboratoryCharge",
    "LaboratoryCharge",
    "laboratoryCharges",
    "LaboratoryCharges",
    "laboratoryAmount",
    "LaboratoryAmount",
    "labFee",
    "LabFee",
    "testCharge",
    "TestCharge",
    "testCharges",
    "TestCharges",
    "labTestCharge",
    "LabTestCharge",
    "labTestCharges",
    "LabTestCharges",
    "diagnosticCharge",
    "DiagnosticCharge",
    "diagnosticCharges",
    "DiagnosticCharges",
  ],
  total: [
    "totalAmount",
    "TotalAmount",
    "total",
    "Total",
    "grandTotal",
    "GrandTotal",
    "netAmount",
    "NetAmount",
    "paidAmount",
    "PaidAmount",
    "amount",
    "Amount",
  ],
};

const readAmount = (source, keys, fallback = 0) => {
  if (!source || typeof source !== "object") return Number(fallback || 0);

  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") {
      const amount = Number(value);
      if (Number.isFinite(amount)) return amount;
    }
  }

  for (const nestedKey of ["billing", "bill", "invoice", "payment", "charges", "amounts", "totals"]) {
    const nestedValue = source[nestedKey] || source[nestedKey.charAt(0).toUpperCase() + nestedKey.slice(1)];
    if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      const amount = readAmount(nestedValue, keys, NaN);
      if (Number.isFinite(amount)) return amount;
    }
  }

  return Number(fallback || 0);
};

const getSavedBillAmount = (bill = {}, fallback = 0) =>
  readAmount(
    bill,
    [
      "totalAmount",
      "TotalAmount",
      "netAmount",
      "NetAmount",
      "payableAmount",
      "PayableAmount",
      "grandTotal",
      "GrandTotal",
      "paidAmount",
      "PaidAmount",
      "paymentAmount",
      "PaymentAmount",
      "amount",
      "Amount",
      "revenue",
      "Revenue",
    ],
    fallback
  );

const getTaxableFromGstTotal = (amount = 0) =>
  Math.round((Math.max(0, Number(amount) || 0) / (1 + HALF_GST_RATE * 2)) * 100) / 100;

const getItemLabel = (item = {}) =>
  String(
    firstValue(
      item.label,
      item.Label,
      item.name,
      item.Name,
      item.title,
      item.Title,
      item.description,
      item.Description,
      item.serviceName,
      item.ServiceName,
      item.chargeType,
      item.ChargeType,
      item.type,
      item.Type,
      item.category,
      item.Category
    ) || ""
  ).toLowerCase();

const getItemAmount = (item = {}) =>
  readAmount(
    item,
    [
      "amount",
      "Amount",
      "charge",
      "Charge",
      "charges",
      "Charges",
      "price",
      "Price",
      "fee",
      "Fee",
      "total",
      "Total",
      "totalAmount",
      "TotalAmount",
      "lineTotal",
      "LineTotal",
    ],
    0
  );

const readItemizedAmount = (source, keywords = []) => {
  if (!source || typeof source !== "object") return 0;

  const arrayKeys = [
    "items",
    "Items",
    "lineItems",
    "LineItems",
    "billItems",
    "BillItems",
    "billingItems",
    "BillingItems",
    "billingDetails",
    "BillingDetails",
    "chargeDetails",
    "ChargeDetails",
    "charges",
    "Charges",
    "services",
    "Services",
    "particulars",
    "Particulars",
  ];

  for (const key of arrayKeys) {
    const value = source[key];
    if (!Array.isArray(value)) continue;

    const sum = value.reduce((amount, item) => {
      const label = getItemLabel(item);
      const matches = keywords.some((keyword) => label.includes(keyword));
      return matches ? amount + getItemAmount(item) : amount;
    }, 0);

    if (sum > 0) return sum;
  }

  for (const nestedKey of ["billing", "bill", "invoice", "payment", "details", "data", "result"]) {
    const nestedValue = source[nestedKey] || source[nestedKey.charAt(0).toUpperCase() + nestedKey.slice(1)];
    if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      const amount = readItemizedAmount(nestedValue, keywords);
      if (amount > 0) return amount;
    }
  }

  return 0;
};

const SERVICE_ITEM_ARRAY_KEYS = [
  "rows",
  "Rows",
  "lineItems",
  "LineItems",
  "serviceItems",
  "ServiceItems",
  "items",
  "Items",
  "billItems",
  "BillItems",
  "billingItems",
  "BillingItems",
  "billingDetails",
  "BillingDetails",
  "diagnosticTests",
  "DiagnosticTests",
  "labTests",
  "LabTests",
  "tests",
  "Tests",
  "medicines",
  "Medicines",
  "medications",
  "Medications",
];

const collectServiceItems = (source, seen = new Set()) => {
  if (!source || typeof source !== "object" || seen.has(source)) return [];
  seen.add(source);

  const directRows = SERVICE_ITEM_ARRAY_KEYS.flatMap((key) => {
    const value = source[key];
    return Array.isArray(value) ? value : [];
  });

  const nestedRows = ["billing", "bill", "invoice", "payment", "details", "data", "result"].flatMap((key) => {
    const nested = source[key] || source[key.charAt(0).toUpperCase() + key.slice(1)];
    return nested && typeof nested === "object" && !Array.isArray(nested) ? collectServiceItems(nested, seen) : [];
  });

  return [...directRows, ...nestedRows];
};

const getServiceLineItemName = (row = {}, billType = "diagnostic") =>
  firstValue(
    row.item,
    row.Item,
    row.label,
    row.Label,
    row.testName,
    row.TestName,
    row.test,
    row.Test,
    row.name,
    row.Name,
    row.serviceName,
    row.ServiceName,
    row.medicineName,
    row.MedicineName,
    row.productName,
    row.ProductName,
    row.description,
    row.Description,
    billType === "pharmacy" ? "Pharmacy Charges" : "Diagnostic Charges"
  );

const normalizeServiceBillRows = (bill = {}, billType = "diagnostic") =>
  collectServiceItems(bill)
    .map((row, index) => {
      const quantity = Math.max(1, Number(firstValue(row.quantity, row.Quantity, row.qty, row.Qty, row.count, row.Count, 1)) || 1);
      const unitAmount = readAmount(row, ["unitPrice", "UnitPrice", "price", "Price", "rate", "Rate", "mrp", "MRP"], 0);
      const lineAmount = readAmount(row, ["amount", "Amount", "total", "Total", "totalAmount", "TotalAmount", "netAmount", "NetAmount", "lineTotal", "LineTotal"], 0);
      const unitPrice = unitAmount || (lineAmount > 0 ? lineAmount / quantity : 0);
      return {
        id: firstValue(row.id, row.Id, row.testId, row.TestId, row.itemId, row.ItemId, `${billType}-${index}`),
        diagnosis: firstValue(row.diagnosis, row.Diagnosis, row.category, row.Category, row.department, row.Department, ""),
        item: getServiceLineItemName(row, billType),
        unitPrice,
        quantity: billType === "pharmacy" ? quantity : 1,
      };
    })
    .filter((row) => String(row.item || "").trim() && Number(row.unitPrice || 0) > 0);

const formatInvoiceDate = (value = new Date()) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString("en-IN");

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const createBillingRow = (priceList) => {
  const item = priceList[0] || { diagnosis: "", item: "", price: 0 };
  return {
    ...item,
    id: Date.now() + Math.random(),
    diagnosis: item.diagnosis,
    item: item.item,
    unitPrice: item.price,
    quantity: 1,
  };
};

const splitDiagnosticTests = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const readAppointmentDiagnosticTests = (appointment = {}) => {
  const explicitTests = firstValue(
    appointment.diagnosisTests,
    appointment.DiagnosisTests,
    appointment.diagnosticTests,
    appointment.DiagnosticTests,
    appointment.tests,
    appointment.Tests,
    appointment.consultation?.diagnosisTests,
    appointment.Consultation?.DiagnosisTests,
    appointment.consultation?.diagnosticTests,
    appointment.Consultation?.DiagnosticTests,
    appointment.latestConsultation?.diagnosisTests,
    appointment.LatestConsultation?.DiagnosisTests
  );
  if (explicitTests) return explicitTests;

  const notes = String(
    firstValue(
      appointment.clinicalNotes,
      appointment.ClinicalNotes,
      appointment.notes,
      appointment.Notes,
      appointment.consultation?.clinicalNotes,
      appointment.Consultation?.ClinicalNotes,
      appointment.latestConsultation?.clinicalNotes,
      appointment.LatestConsultation?.ClinicalNotes,
      ""
    ) || ""
  );
  return notes.match(/Diagnosis Tests\s*:\s*([^\n\r]+)/i)?.[1] || "";
};

const readAppointmentDiagnosis = (appointment = {}) =>
  firstValue(
    appointment.diagnosis,
    appointment.Diagnosis,
    appointment.consultation?.diagnosis,
    appointment.Consultation?.Diagnosis,
    appointment.latestConsultation?.diagnosis,
    appointment.LatestConsultation?.Diagnosis
  );

const getPriceListItemName = (item = {}) =>
  String(firstValue(item.item, item.testName, item.TestName, item.name, item.Name, item.serviceName, item.testCode, item.TestCode, "") || "").trim();

const getPriceListItemKey = (item = {}, index = 0) =>
  String(firstValue(item.id, item.testId, item.labTestId, item.testCode, item.TestCode, getPriceListItemName(item), index) || index);

const normalizeDiscountPercent = (value) =>
  Math.min(100, Math.max(0, Number(value) || 0));

const getDiscountAmount = (amount, discountPercent) =>
  Math.round(((Math.max(0, Number(amount) || 0) * normalizeDiscountPercent(discountPercent)) / 100) * 100) / 100;

const readDiscountPercent = (bill = {}, baseAmount = 0) => {
  for (const key of ["discountPercentage", "DiscountPercentage", "discountPercent", "DiscountPercent"]) {
    if (bill?.[key] !== undefined && bill?.[key] !== null && bill?.[key] !== "") {
      const explicitPercent = Number(bill[key]);
      if (Number.isFinite(explicitPercent)) return normalizeDiscountPercent(explicitPercent);
    }
  }

  const discountAmount = readAmount(bill, ["discount", "Discount", "discountAmount", "DiscountAmount"], 0);
  const amount = Number(baseAmount) || 0;
  return amount > 0 ? normalizeDiscountPercent((discountAmount / amount) * 100) : 0;
};

const getBillingTotals = (rows = [], discountPercent = 0) => {
  const subtotal = rows.reduce(
    (sum, row) => sum + (Number(row.unitPrice) || 0) * (Number(row.quantity) || 0),
    0
  );
  const cgst = subtotal * HALF_GST_RATE;
  const sgst = subtotal * HALF_GST_RATE;
  const grossTotal = subtotal + cgst + sgst;
  const discountPercentage = normalizeDiscountPercent(discountPercent);
  const discountAmount = getDiscountAmount(grossTotal, discountPercentage);
  return {
    subtotal,
    cgst,
    sgst,
    gst: cgst + sgst,
    grossTotal,
    discountPercentage,
    discountAmount,
    total: Math.max(0, grossTotal - discountAmount),
  };
};

const printServiceInvoice = ({
  type,
  invoiceNo: providedInvoiceNo,
  rows,
  totals,
  patientName,
  patientId,
  patientPhone,
  patientAge,
  patientGender,
  appointmentId,
  tokenNumber,
  createdAt,
  doctorName,
  paymentMode,
  clinicName,
  clinicId,
  clinicPhone,
  clinicEmail,
  receptionistName,
  autoPrint = true,
}) => {
  const invoiceNo = providedInvoiceNo || createInvoiceNo(type === "pharmacy" ? "PH" : "DT");
  const createdDate = createdAt ? new Date(createdAt) : new Date();
  const invoiceDate = createdDate.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const printDate = new Date().toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const title = type === "pharmacy" ? "Pharmacy GST Invoice" : "Diagnostic Test GST Invoice";
  const itemHeader = type === "pharmacy" ? "Product / Medicine" : "Diagnostic Test";
  const branding = getClinicInvoiceBranding({ clinicId, clinicName });
  const logoUrl = branding.logoUrl;
  const headerTitle = branding.headerTitle || clinicName;
  const headerSubtitle = branding.headerSubtitle || "Clinic Billing";
  const footerNote = branding.footerNote;
  const brandingClinicAddress = branding.clinicAddress || "";
  const brandingClinicPhone = branding.clinicPhone || clinicPhone || "";
  const brandingClinicEmail = branding.clinicEmail || clinicEmail || "";
  const brandingGstNumber = branding.gstNumber || "";
  const brandingRegistrationNumber = branding.registrationNumber || "";
  const accentColor = branding.accentColor || "#0f9d9d";
  const printWindow = window.open("", "_blank", "width=980,height=720");
  if (!printWindow) return false;

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)} ${escapeHtml(invoiceNo)}</title>
        <style>
          @page { size: A4; margin: 14mm; }
          body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; background: #f3f8fb; }
          .invoice { max-width: 940px; min-height: 100vh; margin: 0 auto; background: #fff; padding: 28px; border-top: 8px solid ${escapeHtml(accentColor)}; box-sizing: border-box; position: relative; overflow: hidden; }
          .invoice > *:not(.watermark) { position: relative; z-index: 1; }
          .watermark { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 0; }
          .watermark img { width: 410px; height: 410px; object-fit: contain; opacity: .18; filter: saturate(1.35) contrast(1.08); }
          .head { display: grid; grid-template-columns: 1fr auto; gap: 20px; border-bottom: 2px solid #0f172a; padding-bottom: 14px; }
          .clinic-title { display: flex; align-items: center; gap: 12px; }
          .clinic-title img { width: 54px; height: 54px; object-fit: contain; border-radius: 12px; }
          .head h1 { margin: 0; font-size: 21px; color: #0f172a; }
          .head p { margin: 4px 0 0; color: #475569; font-size: 12px; }
          .badge { text-align: right; }
          .badge strong { display: block; font-size: 18px; margin-top: 7px; }
          .badge span { display: inline-flex; background: #e6fffb; color: #087d7d; border: 1px solid #9bdad7; border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 900; text-transform: uppercase; }
          .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
          .meta div { border: 1px solid #d9e6ea; border-radius: 8px; padding: 8px 10px; background: #fbfeff; }
          .meta span { display: block; color: #64748b; font-size: 10px; font-weight: 800; text-transform: uppercase; }
          .meta b { display: block; margin-top: 3px; font-size: 12px; color: #111827; }
          .party { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin: 18px 0; }
          .panel { border: 1px solid #d9e6ea; border-radius: 10px; padding: 14px; background: #fbfeff; }
          .panel h2 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; color: #0f172a; }
          .info { display: grid; grid-template-columns: 104px 1fr; gap: 7px; font-size: 12px; }
          .info span { color: #64748b; font-weight: 700; }
          .info b { color: #111827; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #d6e1e7; padding: 9px 8px; font-size: 12px; text-align: left; }
          th { background: #eaf8f6; color: #0f172a; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
          td.num, th.num { text-align: center; }
          td.money, th.money { text-align: right; font-variant-numeric: tabular-nums; }
          .item-detail { display: grid; gap: 3px; }
          .item-detail small { color: #64748b; font-size: 11px; }
          tfoot td { background: #f0fdfa; border-top: 2px solid ${escapeHtml(accentColor)}; color: #0f172a; font-weight: 900; }
          tfoot td:last-child { background: #d9f7f3; color: #0f172a; }
          .foot { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-top: 28px; border-top: 1px dashed #94a3b8; padding-top: 14px; color: #475569; font-size: 12px; }
          .sign { color: #0f172a; font-weight: 900; text-align: center; min-width: 190px; padding-top: 28px; border-top: 1px solid #64748b; }
          @media print { body { background: #fff; } .invoice { border-top-color: #111827; padding: 0; } }
        </style>
      </head>
      <body>
        <main class="invoice">
          <div class="watermark"><img src="${escapeHtml(logoUrl)}" alt="" /></div>
          <div style="position: absolute; top: 22px; right: 28px; border: 3px double #10b981; border-radius: 6px; padding: 4px 14px; color: #059669; font-size: 20px; font-weight: 900; letter-spacing: 2.5px; transform: rotate(-6deg); background: rgba(16,185,129,0.08); text-transform: uppercase; z-index: 10; pointer-events: none;">
            PAID
          </div>
          <section class="head">
            <div>
              <div class="clinic-title">
                <img src="${escapeHtml(logoUrl)}" alt="Clinic logo" />
                <h1>${escapeHtml(headerTitle)} ${type === "pharmacy" ? "Pharmacy" : "Diagnostics"}</h1>
              </div>
              <p>${escapeHtml([headerSubtitle, brandingClinicPhone, brandingClinicEmail].filter(Boolean).join(" | "))}</p>
              ${brandingClinicAddress ? `<p>${escapeHtml(brandingClinicAddress)}</p>` : ""}
              ${brandingGstNumber ? `<p>GSTIN: ${escapeHtml(brandingGstNumber)}</p>` : ""}
              ${brandingRegistrationNumber ? `<p>Reg No: ${escapeHtml(brandingRegistrationNumber)}</p>` : ""}
            </div>
            <div class="badge">
              <span>${escapeHtml(title)}</span>
              <strong>${escapeHtml(invoiceNo)}</strong>
              <p>Inv. Date: ${escapeHtml(invoiceDate)}</p>
            </div>
          </section>
          <section class="meta">
            <div><span>${type === "pharmacy" ? "Bill No" : "Diagnostic Bill No"}</span><b>${escapeHtml(invoiceNo)}</b></div>
            <div><span>Appointment / OP No</span><b>${escapeHtml(appointmentId || "-")}</b></div>
            <div><span>Token No</span><b>${escapeHtml(tokenNumber || "-")}</b></div>
            <div><span>Print Date</span><b>${escapeHtml(printDate)}</b></div>
          </section>
          <section class="party">
            <div class="panel">
              <h2>Patient</h2>
              <div class="info">
                <span>Name</span><b>${escapeHtml(patientName || "-")}</b>
                <span>Patient ID</span><b>${escapeHtml(patientId || "-")}</b>
                <span>Age / Gender</span><b>${escapeHtml([patientAge, patientGender].filter((item) => item && item !== "-").join(" / ") || "-")}</b>
                <span>Phone</span><b>${escapeHtml(patientPhone || "-")}</b>
                <span>Ref. Doctor</span><b>${escapeHtml(doctorName || "-")}</b>
              </div>
            </div>
            <div class="panel">
              <h2>Payment</h2>
              <div class="info">
                <span>Mode</span><b>${escapeHtml(paymentMode || "-")}</b>
                <span>Generated By</span><b>${escapeHtml(receptionistName || "-")}</b>
                <span>Created Date</span><b>${escapeHtml(invoiceDate)}</b>
                <span>GST</span><b>CGST 9% + SGST 9%</b>
              </div>
            </div>
          </section>
          <table>
            <thead>
              <tr>
                <th class="num">SNo</th>
                <th>${escapeHtml(itemHeader)}</th>
                ${type === "pharmacy" ? '<th class="num">Qty</th>' : ""}
                <th class="money">Amount</th>
                <th class="money">CGST</th>
                <th class="money">SGST</th>
                <th class="money">Net Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((row, index) => {
                  const amount = (Number(row.unitPrice) || 0) * (Number(row.quantity) || 0);
                  const cgst = amount * HALF_GST_RATE;
                  const sgst = amount * HALF_GST_RATE;
                  const detail = row.diagnosis && type !== "pharmacy" ? `<small>Diagnosis: ${escapeHtml(row.diagnosis)}</small>` : "";
                  return `
                    <tr>
                      <td class="num">${index + 1}</td>
                      <td><span class="item-detail"><strong>${escapeHtml(row.item)}</strong>${detail}</span></td>
                      ${type === "pharmacy" ? `<td class="num">${Number(row.quantity) || 1}</td>` : ""}
                      <td class="money">${amountFormat(amount)}</td>
                      <td class="money">${amountFormat(cgst)}</td>
                      <td class="money">${amountFormat(sgst)}</td>
                      <td class="money">${amountFormat(amount + cgst + sgst)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="${type === "pharmacy" ? 3 : 2}">Sub Total</td>
                <td class="money">${amountFormat(totals.subtotal)}</td>
                <td class="money">${amountFormat(totals.cgst)}</td>
                <td class="money">${amountFormat(totals.sgst)}</td>
                <td class="money">${amountFormat(totals.grossTotal ?? totals.total)}</td>
              </tr>
              <tr>
                <td colspan="${type === "pharmacy" ? 6 : 5}">Discount (${Number(totals.discountPercentage || 0)}%)</td>
                <td class="money">-${amountFormat(totals.discountAmount || 0)}</td>
              </tr>
              <tr>
                <td colspan="${type === "pharmacy" ? 6 : 5}">Net Amount</td>
                <td class="money">${amountFormat(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
          <section class="foot">
            <p>${escapeHtml(footerNote)}<br />Print on: ${escapeHtml(invoiceDate)}</p>
            <div class="sign">Authorized Signature</div>
          </section>
        </main>
        ${autoPrint ? "<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };</script>" : ""}
      </body>
    </html>
  `);
  printWindow.document.close();
  return true;
};

const getInvoiceNumber = (invoice) =>
  firstValue(
    invoice?.invoiceNo,
    invoice?.invoiceNumber,
    invoice?.billNo,
    invoice?.billNumber,
    invoice?.billingId,
    invoice?.billId,
    invoice?.paymentId,
    invoice?.transactionId,
    invoice?.id,
    invoice?.appointmentId ? `APT-${invoice.appointmentId}` : ""
  ) || "-";

const getInvoiceId = (invoice) =>
  firstValue(
    invoice?.id,
    invoice?.Id,
    invoice?.billingId,
    invoice?.BillingId,
    invoice?.billId,
    invoice?.BillId,
    invoice?.invoiceId,
    invoice?.InvoiceId
  ) || "";

const hasBackendBillingId = (invoice) =>
  Boolean(firstValue(invoice?.billingId, invoice?.BillingId, invoice?.billId, invoice?.BillId, invoice?.invoiceId, invoice?.InvoiceId));

const updateBillingBill = async (bill, payload = {}) => {
  const billId = getInvoiceId(bill);
  if (!billId) return null;

  return requestJson(`Billing/${billId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...payload,
      id: billId,
      Id: billId,
      billId,
      BillId: billId,
    }),
  });
};

const deleteBillingBill = async (bill) => {
  const billId = getInvoiceId(bill);
  if (!billId) return false;

  await requestJson(`Billing/${billId}`, {
    method: "DELETE",
  });
  return true;
};

const getInvoiceStatus = (invoice) =>
  firstValue(invoice?.paymentStatus, invoice?.invoiceStatus, invoice?.billingStatus, invoice?.status) ||
  "Paid";

const getInvoiceDate = (invoice) =>
  firstValue(invoice?.createdAt, invoice?.createdOn, invoice?.invoiceDate, invoice?.date) ||
  new Date();

const getAppointmentId = (appointment) =>
  firstValue(
    appointment?.appointmentId,
    appointment?.AppointmentId,
    appointment?.id,
    appointment?.Id,
    appointment?.appointment?.id,
    appointment?.appointment?.appointmentId
  ) || "";

const getAppointmentStatus = (appointment = {}) => {
  const source = appointment || {};
  return String(
    source.status ??
    source.Status ??
    source.appointmentStatus ??
    source.AppointmentStatus ??
    source.billingStatus ??
    source.BillingStatus ??
    source.paymentStatus ??
    source.PaymentStatus ??
    source.appointment?.status ??
    source.appointment?.Status ??
    source.appointment?.appointmentStatus ??
    source.Appointment?.Status ??
    source.Appointment?.AppointmentStatus ??
    source.state ??
    source.State ??
    ""
  )
    .trim()
    .toLowerCase();
};

const getAppointmentPatientName = (appointment = {}) => {
  const source = appointment || {};
  return (
    firstValue(
      source.patientName,
      source.PatientName,
      source.patient?.name,
      source.Patient?.Name,
      source.patient?.fullName,
      source.Patient?.FullName
    ) || "-"
  );
};

const getAppointmentPatientId = (appointment = {}) => {
  const source = appointment || {};
  return (
    firstValue(
      source.patientId,
      source.PatientId,
      source.pid,
      source.PID,
      source.patientCode,
      source.PatientCode,
      source.patient?.id,
      source.Patient?.Id,
      source.patient?.patientId,
      source.Patient?.PatientId,
      source.patient?.pid,
      source.Patient?.PID,
      source.patient?.patientCode,
      source.Patient?.PatientCode
    ) || "-"
  );
};

const getAppointmentDoctorName = (appointment = {}) => {
  const source = appointment || {};
  return (
    firstValue(
      source.doctorName,
      source.DoctorName,
      source.doctor?.name,
      source.Doctor?.Name,
      source.doctor?.fullName,
      source.Doctor?.FullName
    ) || "-"
  );
};

const getAppointmentPatientPhone = (appointment = {}) => {
  const source = appointment || {};
  return (
    firstValue(
      source.phone,
      source.Phone,
      source.mobile,
      source.Mobile,
      source.patientPhone,
      source.PatientPhone,
      source.patientMobile,
      source.PatientMobile,
      source.patient?.phone,
      source.Patient?.Phone,
      source.patient?.mobile,
      source.Patient?.Mobile
    ) || "-"
  );
};

const getAppointmentPatientAge = (appointment = {}) => {
  const source = appointment || {};
  return (
    firstValue(
      source.age,
      source.Age,
      source.patientAge,
      source.PatientAge,
      source.patient?.age,
      source.Patient?.Age
    ) || "-"
  );
};

const getAppointmentPatientGender = (appointment = {}) => {
  const source = appointment || {};
  return (
    firstValue(
      source.gender,
      source.Gender,
      source.patientGender,
      source.PatientGender,
      source.patient?.gender,
      source.Patient?.Gender
    ) || "-"
  );
};

const getAppointmentTokenNumber = (appointment = {}) =>
  firstValue(
    appointment?.tokenNo,
    appointment?.TokenNo,
    appointment?.tokenNumber,
    appointment?.TokenNumber,
    appointment?.opNo,
    appointment?.OpNo,
    appointment?.opNumber,
    appointment?.OpNumber,
    appointment?.queueNo,
    appointment?.QueueNo
  ) || "-";

const getAppointmentTime = (appointment = {}) => {
  const source = appointment || {};
  return (
    firstValue(
      source.time,
      source.Time,
      source.slot,
      source.Slot,
      source.startTime,
      source.StartTime
    ) || "-"
  );
};

const getAppointmentDate = (appointment = {}) =>
  firstValue(
    appointment?.appointmentDate,
    appointment?.AppointmentDate,
    appointment?.date,
    appointment?.Date,
    appointment?.slotDate,
    appointment?.SlotDate,
    appointment?.bookingDate,
    appointment?.BookingDate,
    appointment?.createdAt,
    appointment?.CreatedAt
  ) || new Date();

const getAppointmentDateKey = (appointment = {}) => normalizeDateKey(getAppointmentDate(appointment));

const getAppointmentPaidAmount = (appointment = {}) =>
  readAmount(
    appointment,
    [
      "paidAmount",
      "PaidAmount",
      "consultationFee",
      "ConsultationFee",
      "consultationCharge",
      "ConsultationCharge",
      "amount",
      "Amount",
      "totalAmount",
      "TotalAmount",
    ],
    0
  );

const isPaidAppointmentBooking = (appointment = {}) => {
  const status = String(
    firstValue(
      appointment.paymentStatus,
      appointment.PaymentStatus,
      appointment.payment?.status,
      appointment.Payment?.Status,
      appointment.status,
      appointment.Status
    ) || ""
  ).toLowerCase();

  return status.includes("paid") || getAppointmentPaidAmount(appointment) > 0;
};

const appointmentToOpBill = (appointment = {}) => {
  const appointmentId = getAppointmentId(appointment);
  const amount = getAppointmentPaidAmount(appointment);
  const createdAt = getAppointmentDate(appointment);

  return normalizeServiceBill({
    ...appointment,
    type: "consultation",
    invoiceType: "op",
    InvoiceType: "op",
    billingType: "OP",
    BillingType: "OP",
    serviceType: "OP Billing",
    invoiceNo:
      appointment.invoiceNo ||
      appointment.invoiceNumber ||
      appointment.receiptNo ||
      appointment.ReceiptNo ||
      appointment.transactionId ||
      appointment.TransactionId ||
      (appointmentId ? `OP-${appointmentId}` : ""),
    appointmentId,
    patientId: getAppointmentPatientId(appointment),
    patientName: getAppointmentPatientName(appointment),
    doctorName: getAppointmentDoctorName(appointment),
    createdAt,
    billDate: createdAt,
    invoiceDate: createdAt,
    consultationCharge: amount,
    consultationCharges: amount,
    totalAmount: amount,
    grandTotal: amount,
    netAmount: amount,
    paidAmount: amount,
    amount,
    paymentStatus: "Paid",
    status: "Paid",
    paymentMode:
      appointment.paymentMode ||
      appointment.PaymentMode ||
      appointment.payment?.mode ||
      appointment.Payment?.Mode ||
      "-",
  });
};

const fetchBillingAppointments = async () => {
  // The backend Billing/appointments endpoint is already restricted to the
  // logged-in receptionist hospital and branch. Keep that as the source of
  // truth so a cross-branch appointment cannot later fail POST /api/Billing
  // with 403 Forbidden.
  const [billingAppointments, appointments] = await Promise.all([
    requestJson("Billing/appointments"),
    requestJson("Appointment").catch(() => []),
  ]);

  const scoped = parseList(billingAppointments);
  const generalById = new Map(
    parseList(appointments).map((item) => [String(getAppointmentId(item)), item])
  );

  return scoped.map((appointment) => {
    const id = String(getAppointmentId(appointment));
    const detail = generalById.get(id);
    // Spread the scoped Billing payload last so HospitalId/BranchId stay
    // authoritative even if the general Appointment response differs.
    return detail ? { ...detail, ...appointment } : appointment;
  });
};

const getPatientId = (patient = {}) => {
  const source = patient || {};
  return (
    firstValue(
      source.id,
      source.Id,
      source.patientId,
      source.PatientId,
      source.pid,
      source.PID,
      source.patientCode,
      source.PatientCode
    ) || ""
  );
};

const attachPatientToAppointment = (appointment = {}, patientsById = new Map()) => {
  const patient =
    patientsById.get(String(getAppointmentPatientId(appointment))) ||
    patientsById.get(String(appointment.patientCode || appointment.PatientCode || "")) ||
    appointment.patient ||
    appointment.Patient ||
    null;

  if (!patient) return appointment;

  return {
    ...appointment,
    patient,
    Patient: appointment.Patient || patient,
    patientName: getAppointmentPatientName(appointment) !== "-"
      ? getAppointmentPatientName(appointment)
      : firstValue(patient.name, patient.Name, patient.fullName, patient.FullName),
    patientId: firstValue(appointment.patientId, appointment.PatientId, getPatientId(patient)),
    branchId: firstValue(appointment.branchId, appointment.BranchId, patient.branchId, patient.BranchId),
    branchName: firstValue(
      appointment.branchName,
      appointment.BranchName,
      appointment.branch,
      appointment.Branch,
      patient.branchName,
      patient.BranchName,
      patient.branch,
      patient.Branch
    ),
    hospitalId: firstValue(
      appointment.hospitalId,
      appointment.HospitalId,
      appointment.clinicId,
      appointment.ClinicId,
      patient.hospitalId,
      patient.HospitalId,
      patient.clinicId,
      patient.ClinicId
    ),
  };
};

const appointmentBelongsToBillingScope = (appointment, scope) => {
  if (belongsToReceptionistScope(appointment, scope)) return true;

  const patient = appointment?.patient || appointment?.Patient;
  if (patient && belongsToReceptionistScope(patient, scope)) {
    return true;
  }

  return false;
};

const getInvoiceAmounts = ({ invoice, form, selectedAppointment, total }) => {
  let medicine =
    readAmount(invoice, AMOUNT_KEYS.medicine, 0) ||
    readItemizedAmount(invoice, ["medicine", "medication", "pharmacy", "drug"]) ||
    Number(form.medicineCharges || 0);
  const lab =
    readAmount(invoice, AMOUNT_KEYS.lab, 0) ||
    readItemizedAmount(invoice, ["lab", "laboratory", "test", "diagnostic"]) ||
    Number(form.labCharges || 0);
  const lineTotal = medicine + lab;
  const invoiceTotal = readAmount(invoice, AMOUNT_KEYS.total, total);
  const unitemizedBalance = invoiceTotal - lineTotal;

  if (invoice && invoiceTotal > 0 && unitemizedBalance > 0 && medicine === 0 && lab === 0) {
    medicine = unitemizedBalance;
  }

  return {
    medicine,
    lab,
    total: medicine + lab,
  };
};

const getLatestInvoice = (data) => {
  const invoices = parseList(data);
  return invoices.sort((a, b) => {
    const bDate = new Date(b?.createdAt || 0).getTime();
    const aDate = new Date(a?.createdAt || 0).getTime();
    if (bDate !== aDate) return bDate - aDate;
    return Number(b?.id || 0) - Number(a?.id || 0);
  })[0] || null;
};

const readStoredLatestInvoice = () => {
  try {
    const invoice = JSON.parse(localStorage.getItem(LAST_INVOICE_STORAGE_KEY) || "null");
    return invoice && typeof invoice === "object" ? invoice : null;
  } catch {
    return null;
  }
};

const storeLatestInvoice = (invoice) => {
  if (!invoice || typeof invoice !== "object") return;

  try {
    localStorage.setItem(LAST_INVOICE_STORAGE_KEY, JSON.stringify(invoice));
  } catch {
    // Ignore storage quota/privacy failures; backend invoice remains the source of truth.
  }
};

const readRecentServiceBills = () => {
  try {
    const bills = JSON.parse(localStorage.getItem(RECENT_SERVICE_BILLS_STORAGE_KEY) || "[]");
    return Array.isArray(bills) ? bills : [];
  } catch {
    return [];
  }
};

const readScopedRecentServiceBills = (scope = getReceptionistScope()) =>
  scopeReceptionistRecords(readRecentServiceBills(), scope);

const storeRecentServiceBill = (bill) => {
  if (!bill || typeof bill !== "object") return [];

  const billId = getInvoiceId(bill);
  const nextBills = [
    bill,
    ...readRecentServiceBills().filter((item) => {
      const sameId = billId && String(getInvoiceId(item)) === String(billId);
      const sameInvoice =
        String(item.invoiceNo || item.invoiceNumber || item.billNumber || "") ===
        String(bill.invoiceNo || bill.invoiceNumber || bill.billNumber || "");
      return !(sameId || sameInvoice);
    }),
  ].slice(0, 12);

  try {
    localStorage.setItem(RECENT_SERVICE_BILLS_STORAGE_KEY, JSON.stringify(nextBills));
    if (getServiceBillType(bill) === "diagnostic") {
      window.dispatchEvent(new CustomEvent("receptionDiagnosticBillingCompleted", { detail: bill }));
    }
  } catch {
    // Local recent bills are a convenience; Billing API remains the source for revenue.
  }

  return nextBills;
};

const removeRecentServiceBill = (bill) => {
  const billId = getInvoiceId(bill);
  const invoiceNo = bill?.invoiceNo || bill?.invoiceNumber || bill?.billNumber || "";
  const nextBills = readRecentServiceBills().filter((item) => {
    const sameId = billId && String(getInvoiceId(item)) === String(billId);
    const sameInvoice =
      invoiceNo &&
      String(item.invoiceNo || item.invoiceNumber || item.billNumber || "") === String(invoiceNo);
    return !(sameId || sameInvoice);
  });

  try {
    localStorage.setItem(RECENT_SERVICE_BILLS_STORAGE_KEY, JSON.stringify(nextBills));
  } catch {
    // Billing API is the source of truth; local latest-bills cache is best-effort.
  }

  return nextBills;
};

const getServiceBillType = (bill = {}) => {
  const sourcePath = String(bill.__sourcePath || bill.sourcePath || bill.apiPath || "").toLowerCase();
  if (/billing\/pharmacy\b/.test(sourcePath)) return "pharmacy";
  if (/billing\/lab\b/.test(sourcePath)) return "diagnostic";
  if (/billing\/op\b/.test(sourcePath)) return "consultation";

  const invoiceNo = String(
    bill.invoiceNo || bill.invoiceNumber || bill.billNumber || bill.billNo || ""
  ).trim().toLowerCase();
  if (/^(ph|pha|pharmacy)[-_/]/i.test(invoiceNo)) return "pharmacy";
  if (/^(dt|diag|diagnostic|lab)[-_/]/i.test(invoiceNo)) return "diagnostic";
  if (/^(op|consult|consultation)[-_/]/i.test(invoiceNo)) return "consultation";

  const rawType = [
    bill.type,
    bill.invoiceType,
    bill.InvoiceType,
    bill.billingType,
    bill.BillingType,
    bill.serviceType,
    bill.ServiceType,
    bill.billType,
    bill.BillType,
    bill.category,
    bill.Category,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");

  if (/\b(pharmacy|medicine|medical store|drug)\b/.test(rawType)) return "pharmacy";
  if (/\b(diagnostic|diagnosis|lab|laboratory|test)\b/.test(rawType)) return "diagnostic";
  if (/\b(op|outpatient|consultation|consult)\b/.test(rawType)) return "consultation";

  const medicine = readAmount(bill, AMOUNT_KEYS.medicine, 0);
  const lab = readAmount(bill, AMOUNT_KEYS.lab, 0);
  const consultation = readAmount(bill, AMOUNT_KEYS.consultation, 0);
  if (lab > 0 && medicine === 0 && consultation === 0) return "diagnostic";
  if (medicine > 0 && lab === 0 && consultation === 0) return "pharmacy";
  return "consultation";
};

const normalizeServiceBill = (bill = {}) => {
  const type = getServiceBillType(bill);
  const consultationCharge = readAmount(bill, AMOUNT_KEYS.consultation, 0);
  const medicineCharge = readAmount(bill, AMOUNT_KEYS.medicine, 0);
  const labCharge = readAmount(bill, AMOUNT_KEYS.lab, 0);
  const totalAmount = getSavedBillAmount(bill, bill.totalAmount || bill.paidAmount || 0);
  const cgstAmount = readAmount(bill, ["cgstAmount", "CGSTAmount", "cgst", "CGST"], 0);
  const sgstAmount = readAmount(bill, ["sgstAmount", "SGSTAmount", "sgst", "SGST"], 0);
  const gstAmount = readAmount(bill, ["gstAmount", "GSTAmount", "gst", "GST", "taxAmount", "TaxAmount"], cgstAmount + sgstAmount);
  return {
    ...bill,
    type,
    invoiceType: type,
    billingType:
      type === "pharmacy"
        ? "Pharmacy"
        : type === "diagnostic"
          ? "Lab"
          : "OP",
    BillingType:
      type === "pharmacy"
        ? "Pharmacy"
        : type === "diagnostic"
          ? "Lab"
          : "OP",
    invoiceNo: bill.invoiceNo || bill.invoiceNumber || bill.billNumber || bill.billNo,
    invoiceNumber: bill.invoiceNumber || bill.invoiceNo || bill.billNumber || bill.billNo,
    billNumber: bill.billNumber || bill.invoiceNumber || bill.invoiceNo || bill.billNo,
    patientName: bill.patientName || bill.PatientName || bill.patient?.name || bill.Patient?.Name,
    patientId: bill.patientId || bill.PatientId || bill.patient?.patientId || bill.Patient?.PatientId,
    doctorName: bill.doctorName || bill.DoctorName || bill.doctor?.name || bill.Doctor?.Name,
    createdAt: bill.createdAt || bill.CreatedAt || bill.invoiceDate || bill.billDate,
    consultationCharge,
    consultationCharges: consultationCharge,
    medicineCharge,
    medicineCharges: medicineCharge,
    labCharge,
    labCharges: labCharge,
    cgstAmount,
    CGSTAmount: cgstAmount,
    sgstAmount,
    SGSTAmount: sgstAmount,
    gstAmount,
    GSTAmount: gstAmount,
    totalAmount,
    grandTotal: readAmount(bill, ["grandTotal", "GrandTotal"], totalAmount),
    netAmount: readAmount(bill, ["netAmount", "NetAmount"], totalAmount),
    payableAmount: readAmount(bill, ["payableAmount", "PayableAmount"], totalAmount),
    paymentAmount: readAmount(bill, ["paymentAmount", "PaymentAmount"], totalAmount),
    paidAmount: readAmount(bill, ["paidAmount", "PaidAmount"], totalAmount),
    amount: readAmount(bill, ["amount", "Amount"], totalAmount),
    revenue: readAmount(bill, ["revenue", "Revenue"], totalAmount),
  };
};

const billBelongsToMode = (bill = {}, mode = "consultation") =>
  getServiceBillType(bill) === String(mode || "consultation");

const getBillAppointmentId = (bill = {}) =>
  firstValue(
    bill.appointmentId,
    bill.AppointmentId,
    bill.appointment?.appointmentId,
    bill.appointment?.AppointmentId,
    bill.appointment?.id,
    bill.appointment?.Id
  ) || "";

const isBackendApiBill = (bill = {}) =>
  Boolean(bill.__sourcePath || bill.sourcePath || bill.apiPath);

const getServiceBillMergeKey = (bill = {}) => {
  const type = getServiceBillType(bill);
  const appointmentId = getBillAppointmentId(bill);
  if (appointmentId) return `${type}:appointment:${appointmentId}`;

  const invoiceNo = String(bill.invoiceNo || bill.invoiceNumber || bill.billNumber || bill.billNo || "").trim();
  if (invoiceNo) return `${type}:invoice:${invoiceNo}`;

  const billId = getInvoiceId(bill);
  if (billId) return `${type}:id:${billId}`;

  return `${type}:draft:${bill.createdAt || bill.patientId || Math.random()}`;
};

const mergeServiceBillPair = (existing = {}, incoming = {}) => {
  const incomingFromBackend = isBackendApiBill(incoming);
  const existingFromBackend = isBackendApiBill(existing);
  const existingRows = Array.isArray(existing.rows) ? existing.rows : [];
  const incomingRows = Array.isArray(incoming.rows) ? incoming.rows : [];
  const merged = incomingFromBackend
    ? { ...existing, ...incoming }
    : { ...incoming, ...existing };

  return {
    ...merged,
    rows: incomingRows.length ? incomingRows : existingRows,
    totals: incomingFromBackend
      ? incoming.totals || existing.totals
      : existingFromBackend
        ? existing.totals
        : incoming.totals || existing.totals,
  };
};

const mergeRecentServiceBills = (...billGroups) => {
  const byInvoice = new Map();

  billGroups.flat().filter(Boolean).map(normalizeServiceBill).forEach((bill) => {
    const key = getServiceBillMergeKey(bill);
    if (!key) return;
    byInvoice.set(key, byInvoice.has(key) ? mergeServiceBillPair(byInvoice.get(key), bill) : bill);
  });

  return Array.from(byInvoice.values())
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 30);
};

const getLabTestsFromBillingRecords = (records = []) => {
  const itemKeys = [
    "items",
    "Items",
    "lineItems",
    "LineItems",
    "billItems",
    "BillItems",
    "billingItems",
    "BillingItems",
    "serviceItems",
    "ServiceItems",
    "tests",
    "Tests",
    "labTests",
    "LabTests",
    "diagnosticTests",
    "DiagnosticTests",
  ];

  return normalizeLabTests(
    parseList(records).flatMap((record) => {
      const nestedItems = itemKeys.flatMap((key) => (Array.isArray(record?.[key]) ? record[key] : []));
      return [
        ...nestedItems,
        {
          testName: record?.testName || record?.TestName || record?.serviceName || record?.ServiceName || record?.item || record?.Item,
          category: record?.category || record?.Category || record?.department || record?.Department || "Lab",
          price: readAmount(record, AMOUNT_KEYS.lab, readAmount(record, AMOUNT_KEYS.total, 0)),
        },
      ];
    })
  );
};

const syncRecentServiceBillsToBackend = async (scope = getReceptionistScope()) => {
  // Do not automatically POST cached/local bills to the backend.
  // Cached rows may not contain a valid AppointmentId and caused repeated 400 responses.
  return readScopedRecentServiceBills(scope);
};

function ReceptionBilling() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const isNursePath = window.location.pathname.startsWith("/nurse");
  const receptionistProfile = isNursePath ? getNurseProfile() : getReceptionistProfile();
  useRolePermissionsSync(receptionistProfile);
  const canCreateBill = canUseModulePermission(receptionistProfile, "Billing", "Create");
  const canEditBill = canUseModulePermission(receptionistProfile, "Billing", "Edit");
  const canDeleteBill = canUseModulePermission(receptionistProfile, "Billing", "Delete");
  const receptionistScope = useMemo(() => getReceptionistScope(), []);
  const [activeActionState, setActiveActionState] = useState(null);
  const clinicName = getClinicDisplayName(receptionistProfile, "CMS Clinic");
  const clinicId = receptionistProfile.hospitalId || localStorage.getItem("hospitalId") || "";
  const clinicEmail =
    localStorage.getItem("clinicEmail") ||
    localStorage.getItem("hospitalEmail") ||
    receptionistProfile.email ||
    "";
  const clinicPhone =
    localStorage.getItem("clinicPhone") ||
    localStorage.getItem("hospitalPhone") ||
    localStorage.getItem("contactNumber") ||
    "";
  const amountFormatTimers = useRef({});
  const messageTimer = useRef(null);
  const [appointments, setAppointments] = useState([]);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [invoice, setInvoice] = useState(null);
  const getInitialBillingMode = () => {
    try {
      const qp = new URLSearchParams(location?.search || window.location.search || "");
      const q = (qp.get("mode") || qp.get("type") || (location && location.state && location.state.mode) || "").toString().toLowerCase();
      if (q === "pharmacy") return "pharmacy";
      if (q === "diagnostic" || q === "diagnosis") return "diagnostic";
      return "consultation";
    } catch {
      return "consultation";
    }
  };

  const [billingMode, setBillingMode] = useState(getInitialBillingMode);
  const [diagnosticRows, setDiagnosticRows] = useState([]);
  const [labMasterPriceList, setLabMasterPriceList] = useState([]);
  const [labMasterLoading, setLabMasterLoading] = useState(false);
  const [pharmacyRows, setPharmacyRows] = useState([]);
  const [pharmacyPrescriptionLoading, setPharmacyPrescriptionLoading] = useState(false);
  const [recentServiceBills, setRecentServiceBills] = useState(() => readScopedRecentServiceBills(receptionistScope));
  const [editingBill, setEditingBill] = useState(null);
  const [serviceSearch, setServiceSearch] = useState("");
  const [appointmentListView, setAppointmentListView] = useState("today");
  const [appointmentDateFilter, setAppointmentDateFilter] = useState("");
  const [form, setForm] = useState({
    appointmentId: "",
    paymentMode: "UPI",
    medicineCharges: "",
    labCharges: "",
    discount: "0",
  });

  useEffect(() => {
    const qp = new URLSearchParams(location?.search || window.location.search || "");
    const q = (qp.get("mode") || qp.get("type") || (location?.state && location.state.mode) || "").toString().toLowerCase();
    if (q === "pharmacy") setBillingMode("pharmacy");
    else if (q === "diagnostic" || q === "diagnosis") setBillingMode("diagnostic");
    else if (q === "consultation" || q === "appointment" || !q) setBillingMode("consultation");

    const loadBillingData = async () => {
      try {
        const [appointmentsResult, invoicesResult] = await Promise.allSettled([
          fetchBillingAppointments(),
          Promise.allSettled(BILLING_API_PATHS.map((path) => requestJson(path))),
        ]);
        const patientsData = await requestJson("Patient").catch(() => []);

        const appointmentsResultData =
          appointmentsResult.status === "fulfilled" ? appointmentsResult.value : [];
        const invoicesData =
          invoicesResult.status === "fulfilled"
            ? invoicesResult.value.flatMap((result, index) =>
                result.status === "fulfilled"
                  ? parseList(result.value).map((bill) => ({ ...bill, __sourcePath: BILLING_API_PATHS[index] }))
                  : []
              )
            : [];
        const scopedPatients = scopeReceptionistRecords(parseList(patientsData), receptionistScope);
        const patientsById = new Map();

        scopedPatients.forEach((patient) => {
          const id = getPatientId(patient);
          if (id) patientsById.set(String(id), patient);
          if (patient.patientCode || patient.PatientCode) {
            patientsById.set(String(patient.patientCode || patient.PatientCode), patient);
          }
          if (patient.pid || patient.PID) {
            patientsById.set(String(patient.pid || patient.PID), patient);
          }
        });

        const bookedAppointments = parseList(appointmentsResultData)
          .map((appointment) => attachPatientToAppointment(appointment, patientsById));
        const strictList = bookedAppointments.filter((appointment) =>
          appointmentBelongsToBillingScope(appointment, receptionistScope)
        );
        const list = strictList.length
          ? strictList
          : scopeReceptionistRecords(bookedAppointments, receptionistScope, {
              allowMissingBranch: true,
            });
        const invoiceList = parseList(invoicesData).map((bill) => normalizeServiceBill({ ...bill, backendSynced: true }));
        const scopedInvoices = scopeReceptionistRecords(invoiceList, receptionistScope);
        const fallbackScopedInvoices = scopeReceptionistRecords(invoiceList, receptionistScope, {
          allowMissingClinic: true,
          allowMissingBranch: true,
        });

        if (invoicesResult.status !== "fulfilled") {
          console.warn("Unable to load invoices:", invoicesResult.reason);
        }

        const latestInvoice =
          getLatestInvoice(scopedInvoices) ||
          getLatestInvoice(fallbackScopedInvoices) ||
          (invoicesResult.status !== "fulfilled" ? readStoredLatestInvoice() : null);
        setAppointments(list);
        setForm((prev) => ({
          ...prev,
          appointmentId: prev.appointmentId || "",
        }));
        setInvoice(latestInvoice);
        const syncedRecentBills = await syncRecentServiceBillsToBackend(receptionistScope);
        setRecentServiceBills(mergeRecentServiceBills(scopedInvoices, syncedRecentBills));
      } catch (error) {
        setMessage(error.message);
        setMessageType("error");
        toast.error(error.message || "Unable to load billing details.");
      }
    };

    loadBillingData();

    const handleRefresh = () => {
      if (document.visibilityState === "visible") {
        loadBillingData();
      }
    };

    window.addEventListener("focus", loadBillingData);
    document.addEventListener("visibilitychange", handleRefresh);

    return () => {
      window.removeEventListener("focus", loadBillingData);
      document.removeEventListener("visibilitychange", handleRefresh);
    };
  }, [toast, receptionistScope]);

  useEffect(() => {
    const timers = amountFormatTimers.current;

    return () => {
      Object.values(timers).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      if (messageTimer.current) {
        window.clearTimeout(messageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    setServiceSearch("");
  }, [billingMode]);

  useEffect(() => {
    let isActive = true;

    if (billingMode !== "diagnostic") {
      setLabMasterLoading(false);
      setLabMasterPriceList([]);
      return () => {
        isActive = false;
      };
    }

    setLabMasterLoading(true);

    requestJson(getBillingApiPath("diagnostic"))
      .then((tests) => {
        if (!isActive) return;
        const billingTests = getLabTestsFromBillingRecords(tests);
        const cachedTests = getCachedLabMasterTests();
        setLabMasterPriceList(
          normalizeLabTests([...billingTests, ...cachedTests]).map((test) => ({
            ...test,
            diagnosis: test.diagnosis || test.category || "Lab",
            item: getPriceListItemName(test),
            price: Number(test.price) || 0,
          })).filter((test) => test.item)
        );
      })
      .catch((err) => {
        console.warn("Unable to load diagnostic billing tests.", err);
        if (isActive) {
          setLabMasterPriceList(
            getCachedLabMasterTests().map((test) => ({
              ...test,
              diagnosis: test.diagnosis || test.category || "Lab",
              item: getPriceListItemName(test),
              price: Number(test.price) || 0,
            })).filter((test) => test.item)
          );
        }
      })
      .finally(() => {
        if (isActive) setLabMasterLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [billingMode]);

  const clearMessageTimer = () => {
    if (messageTimer.current) {
      window.clearTimeout(messageTimer.current);
      messageTimer.current = null;
    }
  };

  const showMessage = (text, type = "error", { autoHide = false } = {}) => {
    clearMessageTimer();
    setMessage(text);
    setMessageType(type);

    if (autoHide) {
      messageTimer.current = window.setTimeout(() => {
        setMessage("");
        setMessageType("");
        messageTimer.current = null;
      }, 2000);
    }
  };

  const selectedAppointment = useMemo(() => {
    return appointments.find(
      (item) => String(getAppointmentId(item)) === String(form.appointmentId)
    );
  }, [appointments, form.appointmentId]);

  const billedAppointmentIds = useMemo(() => {
    const ids = new Set();
    recentServiceBills
      .filter((bill) => billBelongsToMode(bill, billingMode))
      .forEach((bill) => {
        const appointmentId = getBillAppointmentId(bill);
        if (appointmentId) ids.add(String(appointmentId));
      });
    return ids;
  }, [billingMode, recentServiceBills]);

  const billingAppointmentOptions = useMemo(() => {
    const appointmentHasDiagnosticRequest = (appointment = {}) => {
      const pendingRequest = getPendingDiagnosticRequest({
        appointmentId: getAppointmentId(appointment),
        patientId: getAppointmentPatientId(appointment),
        patientName: getAppointmentPatientName(appointment),
      });

      return Boolean(
        pendingRequest ||
        splitDiagnosticTests(readAppointmentDiagnosticTests(appointment)).length
      );
    };
    return billingMode === "diagnostic"
      ? appointments.filter(appointmentHasDiagnosticRequest)
      : appointments;
  }, [appointments, billingMode]);

  const filteredBillingAppointments = useMemo(() => {
    const todayKey = getTodayKey();
    const dateFiltered = billingAppointmentOptions.filter((appointment) => {
      const appointmentDate = getAppointmentDateKey(appointment);
      const isBilled = billedAppointmentIds.has(String(getAppointmentId(appointment)));
      if (appointmentDateFilter && appointmentDate !== appointmentDateFilter) return false;
      if (isBilled) return appointmentListView === "past";
      if (!appointmentDate) return appointmentListView === "past";
      return appointmentListView === "today"
        ? appointmentDate === todayKey
        : appointmentDate < todayKey;
    });

    return dateFiltered;
  }, [appointmentDateFilter, appointmentListView, billedAppointmentIds, billingAppointmentOptions]);

  useEffect(() => {
    if (!form.appointmentId) return;
    const stillVisible = filteredBillingAppointments.some(
      (appointment) => String(getAppointmentId(appointment)) === String(form.appointmentId)
    );
    if (!stillVisible) {
      setForm((prev) => ({ ...prev, appointmentId: "" }));
    }
  }, [filteredBillingAppointments, form.appointmentId]);

  const todayBillingAppointmentCount = useMemo(
    () => billingAppointmentOptions.filter((appointment) =>
      getAppointmentDateKey(appointment) === getTodayKey() &&
      !billedAppointmentIds.has(String(getAppointmentId(appointment)))
    ).length,
    [billedAppointmentIds, billingAppointmentOptions]
  );
  const pastBillingAppointmentCount = useMemo(
    () => billingAppointmentOptions.filter((appointment) => {
      const appointmentDate = getAppointmentDateKey(appointment);
      return billedAppointmentIds.has(String(getAppointmentId(appointment))) ||
        Boolean(appointmentDate && appointmentDate < getTodayKey());
    }).length,
    [billedAppointmentIds, billingAppointmentOptions]
  );

  useEffect(() => {
    if (billingMode !== "diagnostic") return;

    const appointmentId = getAppointmentId(selectedAppointment);
    if (!appointmentId) {
      setDiagnosticRows([]);
      return;
    }

    let cancelled = false;

    const loadPrescribedTests = async () => {
      try {
        const data = await requestJson(`Lab/orders?appointmentId=${encodeURIComponent(appointmentId)}`);
        const orders = parseList(data).filter(
          (order) =>
            String(order.appointmentId ?? order.AppointmentId ?? "") === String(appointmentId) &&
            String(order.status ?? order.Status ?? "").toLowerCase() !== "cancelled"
        );

        if (cancelled) return;

        if (orders.length) {
          setDiagnosticRows(
            orders.map((order) => ({
              id: order.labOrderId ?? order.LabOrderId ?? order.id ?? order.Id,
              testId: order.labOrderId ?? order.LabOrderId ?? order.id ?? order.Id,
              labTestId: order.labTestId ?? order.LabTestId ?? order.labOrderId ?? order.id,
              diagnosis: order.category ?? order.Category ?? "Lab",
              item: order.testName ?? order.TestName ?? order.name ?? order.Name ?? "Lab Test",
              quantity: 1,
              unitPrice: Number(order.price ?? order.Price ?? 0),
              price: Number(order.price ?? order.Price ?? 0),
              source: "LabOrder",
            }))
          );
          return;
        }

        setDiagnosticRows([]);
      } catch (error) {
        // Backward-compatible fallback for older prescription responses/local drafts.
        const pendingRequest = getPendingDiagnosticRequest({
          appointmentId,
          patientId: getAppointmentPatientId(selectedAppointment),
          patientName: getAppointmentPatientName(selectedAppointment),
        });
        const requestedTests = [
          ...splitDiagnosticTests(readAppointmentDiagnosticTests(selectedAppointment)),
          ...(Array.isArray(pendingRequest?.tests)
            ? pendingRequest.tests
            : splitDiagnosticTests(pendingRequest?.tests)),
        ];
        const diagnosis = readAppointmentDiagnosis(selectedAppointment) || pendingRequest?.diagnosis || "Lab";
        const rows = requestedTests
          .map((testName) => {
            const matched = labMasterPriceList.find(
              (test) => getPriceListItemName(test).toLowerCase() === String(testName).trim().toLowerCase()
            );
            return matched ? createBillingRow([{ ...matched, diagnosis: matched.diagnosis || diagnosis }]) : null;
          })
          .filter(Boolean);
        if (!cancelled) setDiagnosticRows(rows);
        console.warn("Unable to load prescribed LabOrders.", error);
      }
    };

    loadPrescribedTests();
    return () => {
      cancelled = true;
    };
  }, [billingMode, labMasterPriceList, selectedAppointment]);

  // Load medicines from the doctor's saved prescription.
  // The backend PrescriptionItem model does not currently store selling price,
  // so the receptionist enters the unit price only for medicines that were
  // actually prescribed by the doctor.
  useEffect(() => {
    if (billingMode !== "pharmacy") {
      setPharmacyPrescriptionLoading(false);
      setPharmacyRows([]);
      return;
    }

    const appointmentId = getAppointmentId(selectedAppointment);
    if (!appointmentId) {
      setPharmacyRows([]);
      return;
    }

    let cancelled = false;
    setPharmacyPrescriptionLoading(true);

    requestJson(`Billing/appointments/${encodeURIComponent(appointmentId)}/prescription`)
      .then((data) => {
        if (cancelled) return;
        const medicines = parseList(data?.medicines ?? data?.Medicines ?? []);

        setPharmacyRows(
          medicines
            .filter((medicine) =>
              String(medicine?.medicineName ?? medicine?.MedicineName ?? "").trim()
            )
            .map((medicine, index) => ({
              id: medicine.id ?? medicine.Id ?? `rx-${appointmentId}-${index}`,
              prescriptionItemId: medicine.id ?? medicine.Id ?? null,
              diagnosis: data?.diagnosis ?? data?.Diagnosis ?? "Prescription",
              item: medicine.medicineName ?? medicine.MedicineName,
              dosage: medicine.dosage ?? medicine.Dosage ?? "",
              frequency: medicine.frequency ?? medicine.Frequency ?? "",
              duration: medicine.duration ?? medicine.Duration ?? "",
              notes: medicine.notes ?? medicine.Notes ?? "",
              quantity: 1,
              unitPrice: 0,
              price: 0,
              source: "Prescription"
            }))
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setPharmacyRows([]);
          console.warn("Unable to load prescribed medicines.", error);
          showMessage(error.message || "No prescribed medicines were found for this appointment.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) setPharmacyPrescriptionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [billingMode, selectedAppointment]);

  const medicineCharges = Number(form.medicineCharges || 0);
  const labCharges = Number(form.labCharges || 0);
  const total = medicineCharges + labCharges;
  const activeServiceRows = billingMode === "pharmacy" ? pharmacyRows : diagnosticRows;
  const activePriceList = billingMode === "pharmacy" ? [] : labMasterPriceList;
  const serviceDisplayRows = activeServiceRows.map((row) => ({
    ...row,
    quantity: billingMode === "pharmacy" ? Number(row.quantity) || 1 : 1,
  }));
  const serviceDisplayTotals = getBillingTotals(serviceDisplayRows, form.discount);
  const visibleRecentServiceBills = useMemo(
    () => {
      if (billingMode === "consultation") {
        // Show only OP bills that really exist in the backend Billings table.
        // Paid appointments are no longer manufactured into fake OP invoices.
        return scopeReceptionistRecords(recentServiceBills, receptionistScope)
          .filter((bill) =>
            billBelongsToMode(bill, "consultation") &&
            hasBackendBillingId(bill)
          )
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
          .slice(0, 30);
      }

      return scopeReceptionistRecords(recentServiceBills, receptionistScope).filter(
        (bill) => billBelongsToMode(bill, billingMode)
      );
    },
    [billingMode, recentServiceBills, receptionistScope]
  );
  const getValidServiceRows = () =>
    activeServiceRows
      .filter((row) => row.diagnosis && row.item && Number(row.quantity || 1) > 0)
      .map((row) => ({
        ...row,
        quantity: billingMode === "pharmacy" ? Number(row.quantity) || 1 : 1,
      }));

  const buildServiceInvoiceDetails = () => {
    const rows = getValidServiceRows();
    const totals = getBillingTotals(rows, form.discount);
    const hasAppointment = Boolean(selectedAppointment);
    const invoiceNo = `${billingMode === "pharmacy" ? "PH" : "DT"}-${String(Date.now()).slice(-8)}`;
    const createdAt = new Date().toISOString();
    const appointmentPatientId = hasAppointment ? getAppointmentPatientId(selectedAppointment) : "DIRECT";
    const appointmentPatientName = hasAppointment ? getAppointmentPatientName(selectedAppointment) : "Walk-in Patient";
    const appointmentPatientPhone = hasAppointment ? getAppointmentPatientPhone(selectedAppointment) : "-";
    const appointmentPatientAge = hasAppointment ? getAppointmentPatientAge(selectedAppointment) : "-";
    const appointmentPatientGender = hasAppointment ? getAppointmentPatientGender(selectedAppointment) : "-";
    const appointmentId = hasAppointment ? getAppointmentId(selectedAppointment) : "";
    const tokenNumber = hasAppointment ? getAppointmentTokenNumber(selectedAppointment) : "-";
    const appointmentBranchId = firstValue(selectedAppointment?.branchId, selectedAppointment?.BranchId, receptionistScope.branchId);
    const appointmentBranchName = firstValue(
      selectedAppointment?.branchName,
      selectedAppointment?.BranchName,
      selectedAppointment?.branch?.name,
      selectedAppointment?.Branch?.Name,
      receptionistScope.branchName
    );
    return {
      type: billingMode,
      invoiceNo,
      createdAt,
      rows,
      totals,
      patientName: appointmentPatientName,
      patientId: appointmentPatientId,
      patientPhone: appointmentPatientPhone,
      patientAge: appointmentPatientAge,
      patientGender: appointmentPatientGender,
      appointmentId,
      tokenNumber,
      doctorName: hasAppointment ? getAppointmentDoctorName(selectedAppointment) : "Direct Billing",
      paymentMode: form.paymentMode,
      clinicName,
      clinicId,
      clinicPhone,
      clinicEmail,
      branchId: appointmentBranchId,
      branchName: appointmentBranchName,
      receptionistName: receptionistProfile.name,
    };
  };

  const buildServiceBillingPayload = (details) => {
    const isPharmacy = details.type === "pharmacy";
    const subtotal = Number(details.totals.subtotal || 0);
    const discountPercentage = normalizeDiscountPercent(form.discount);
    const discount = getDiscountAmount(Number(details.totals.grossTotal ?? details.totals.total ?? subtotal), discountPercentage);
    const appointmentId = Number(details.appointmentId || 0);
    const patientId = Number(details.patientId || selectedAppointment?.patientId || selectedAppointment?.PatientId || 0);
    const branchId = Number(details.branchId || receptionistScope.branchId || 0);
    const totalAmount = Number(details.totals.total || 0);
    const labCharge = isPharmacy ? 0 : subtotal;
    const medicineCharge = isPharmacy ? subtotal : 0;

    return {
      appointmentId,
      AppointmentId: appointmentId,
      patientId,
      PatientId: patientId,
      branchId,
      BranchId: branchId,
      billingType: isPharmacy ? "Pharmacy" : "Lab",
      BillingType: isPharmacy ? "Pharmacy" : "Lab",
      consultationCharge: 0,
      ConsultationCharge: 0,
      labCharge,
      LabCharge: labCharge,
      medicineCharge,
      MedicineCharge: medicineCharge,
      discount,
      Discount: discount,
      discountPercentage,
      DiscountPercentage: discountPercentage,
      gstPercentage: 18,
      GstPercentage: 18,
      totalAmount,
      TotalAmount: totalAmount,
      paymentMode: String(details.paymentMode || "Cash"),
      PaymentMode: String(details.paymentMode || "Cash"),
      paymentStatus: "Paid",
      PaymentStatus: "Paid",
      paidDate: new Date().toISOString(),
      PaidDate: new Date().toISOString(),
      paymentMethod: String(details.paymentMode || "Cash"),
      transactionId: details.transactionId || `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
      status: "Paid",
      Status: "Paid",
    };
  };

  const createServiceBill = async (_details, payload) => {
    return requestJson(getBillingApiPath(_details.type), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  };

  const openServiceInvoice = async ({ autoPrint = true, save = false } = {}) => {
    const details = buildServiceInvoiceDetails();
    if (!details.appointmentId) {
      const text = "Select a booked appointment before creating the bill.";
      showMessage(text, "error");
      toast.error(text);
      return false;
    }

    if (!details.rows.length) {
      const text = details.type === "diagnostic"
        ? "No prescribed lab tests were found for the selected appointment."
        : "No prescribed medicines were found for the selected appointment.";
      showMessage(text, "error");
      toast.error(text);
      return false;
    }

    if (details.type === "pharmacy" && Number(details.totals.subtotal || 0) <= 0) {
      const text = "Enter a valid unit price for at least one prescribed medicine.";
      showMessage(text, "error");
      toast.error(text);
      return false;
    }

    const discount = Number(form.discount || 0);
    if (discount < 0 || discount > 100) {
      const text = "Discount percentage must be between 0 and 100.";
      showMessage(text, "error");
      toast.error(text);
      return false;
    }

    let savedInvoice = {};
    if (save) {
      const canUpdate = editingBill && getInvoiceId(editingBill) && getServiceBillType(editingBill) === details.type;
      if (canUpdate && !canEditBill) {
        const text = "You do not have permission to edit bills.";
        showMessage(text, "error");
        toast.error(text);
        return false;
      }
      if (!canUpdate && !canCreateBill) {
        const text = "You do not have permission to create bills.";
        showMessage(text, "error");
        toast.error(text);
        return false;
      }
      const payload = buildServiceBillingPayload(details);
      const response = canUpdate
        ? await updateBillingBill(editingBill, payload)
        : await createServiceBill(details, payload);
      savedInvoice = Array.isArray(response) ? response[0] || {} : response || {};

      const invoiceShape = {
        ...payload,
        ...(canUpdate ? editingBill : {}),
        ...savedInvoice,
        invoiceNo: savedInvoice.invoiceNo || savedInvoice.invoiceNumber || savedInvoice.billNumber || editingBill?.invoiceNo || editingBill?.invoiceNumber || editingBill?.billNumber || details.invoiceNo,
        invoiceNumber: savedInvoice.invoiceNumber || savedInvoice.billNumber || editingBill?.invoiceNumber || editingBill?.billNumber || editingBill?.invoiceNo || details.invoiceNo,
        billNumber: savedInvoice.billNumber || savedInvoice.invoiceNumber || editingBill?.billNumber || editingBill?.invoiceNumber || editingBill?.invoiceNo || details.invoiceNo,
        createdAt: savedInvoice.createdAt || savedInvoice.billDate || details.createdAt,
        type: details.type,
        rows: details.rows,
        totals: details.totals,
        patientName: details.patientName,
        patientId: details.patientId,
        doctorName: details.doctorName,
        paymentMode: details.paymentMode,
        invoiceType: details.type === "pharmacy" ? "pharmacy" : "diagnostic",
        InvoiceType: details.type === "pharmacy" ? "pharmacy" : "diagnostic",
        billingType: details.type === "pharmacy" ? "Pharmacy" : "Lab",
        BillingType: details.type === "pharmacy" ? "Pharmacy" : "Lab",
        serviceType: details.type === "pharmacy" ? "Pharmacy Billing" : "Diagnostic Billing",
        ServiceType: details.type === "pharmacy" ? "Pharmacy Billing" : "Diagnostic Billing",
        discountPercentage: details.totals.discountPercentage,
        discountPercent: details.totals.discountPercentage,
        discountAmount: details.totals.discountAmount,
        grossTotal: details.totals.grossTotal,
        totalAmount: details.totals.total,
        paidAmount: details.totals.total,
        paymentStatus: "Paid",
        PaymentStatus: "Paid",
        paidDate: savedInvoice.paidDate || savedInvoice.PaidDate || editingBill?.paidDate || new Date().toISOString(),
        paymentMethod: details.paymentMode || "Cash",
        transactionId: savedInvoice.transactionId || savedInvoice.TransactionId || editingBill?.transactionId || `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
        backendSynced: true,
      };
      setInvoice(invoiceShape);
      storeLatestInvoice(invoiceShape);
      setRecentServiceBills((prev) =>
        mergeRecentServiceBills([invoiceShape], storeRecentServiceBill(invoiceShape), prev)
      );
      if (details.type === "diagnostic") {
        clearPendingDiagnosticRequest({
          appointmentId: details.appointmentId,
          patientId: details.patientId,
          patientName: details.patientName,
        });
      }
      setEditingBill(null);
      showMessage(`${billingMode === "pharmacy" ? "Pharmacy" : "Diagnostic test"} bill ${canUpdate ? "updated" : "generated"} successfully`, "success", { autoHide: true });
      printServiceInvoice({ ...details, invoiceNo: invoiceShape.invoiceNo, autoPrint });
      return true;
    }

    printServiceInvoice({ ...details, autoPrint });
    return true;
  };

  const validateForm = () => {
    const nextErrors = {
      appointmentId: validateSelected(form.appointmentId, "an appointment"),
      paymentMode: validateSelected(form.paymentMode, "a payment mode"),
      medicineCharges: validateNumeric(form.medicineCharges || 0, "Medicine charges"),
      labCharges: validateNumeric(form.labCharges || 0, "Lab charges"),
      discount:
        validateNumeric(form.discount || 0, "Discount") ||
        (Number(form.discount || 0) < 0 || Number(form.discount || 0) > 100
          ? "Discount percentage must be between 0 and 100."
          : ""),
    };

    Object.keys(nextErrors).forEach((key) => {
      if (!nextErrors[key]) delete nextErrors[key];
    });

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const generate = async (event) => {
    event.preventDefault();
    const canUpdate = editingBill && getInvoiceId(editingBill);
    if (canUpdate && !canEditBill) {
      const text = "You do not have permission to edit bills.";
      showMessage(text, "error");
      toast.error(text);
      return;
    }
    if (!canUpdate && !canCreateBill) {
      const text = "You do not have permission to create bills.";
      showMessage(text, "error");
      toast.error(text);
      return;
    }
    if (billingMode !== "consultation") {
      await openServiceInvoice({ autoPrint: true, save: true });
      return;
    }

    if (!validateForm()) {
      const text = "Please fix the highlighted fields.";
      showMessage(text, "error");
      toast.error(text);
      return;
    }

    const invoiceWindow = window.open("", "_blank", "width=860,height=980");
    if (invoiceWindow) {
      invoiceWindow.document.write(`
        <!doctype html>
        <html>
          <head>
            <title>Generating invoice</title>
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                color: #0f172a;
                font-family: Arial, sans-serif;
              }
              .loader {
                border: 1px solid #d9e5ea;
                border-radius: 12px;
                padding: 24px 28px;
                box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
              }
              strong { display: block; margin-bottom: 6px; }
              span { color: #506172; font-size: 13px; }
            </style>
          </head>
          <body>
            <div class="loader">
              <strong>Preparing invoice</strong>
              <span>Please wait while the bill is generated.</span>
            </div>
          </body>
        </html>
      `);
      invoiceWindow.document.close();
    }

    const consultationCharge = Number(
      firstValue(
        selectedAppointment?.consultationFee,
        selectedAppointment?.ConsultationFee,
        selectedAppointment?.doctorFee,
        selectedAppointment?.DoctorFee,
        getAppointmentPaidAmount(selectedAppointment),
        0
      )
    );
    const subtotal = consultationCharge;
    const discountPercentage = normalizeDiscountPercent(form.discount);
    const discount = getDiscountAmount(subtotal, discountPercentage);
    const taxableAmount = Math.max(0, subtotal - discount);
    const totalAmount = taxableAmount;
    const appointmentId = Number(form.appointmentId);
    const patientId = Number(getAppointmentPatientId(selectedAppointment) || selectedAppointment?.patientId || selectedAppointment?.PatientId || 0);
    const branchId = Number(
      firstValue(
        selectedAppointment?.branchId,
        selectedAppointment?.BranchId,
        receptionistScope.branchId,
        0
      )
    ) || 0;

    const body = {
      appointmentId,
      AppointmentId: appointmentId,
      patientId,
      PatientId: patientId,
      branchId,
      BranchId: branchId,
      billingType: "OP",
      BillingType: "OP",
      consultationCharge,
      ConsultationCharge: consultationCharge,
      labCharge: 0,
      LabCharge: 0,
      medicineCharge: 0,
      MedicineCharge: 0,
      discount,
      Discount: discount,
      discountPercentage,
      DiscountPercentage: discountPercentage,
      gstPercentage: 0,
      GstPercentage: 0,
      totalAmount,
      TotalAmount: totalAmount,
      paymentMode: String(form.paymentMode || "Cash"),
      PaymentMode: String(form.paymentMode || "Cash"),
      paymentStatus: "Paid",
      PaymentStatus: "Paid",
      paidDate: new Date().toISOString(),
      PaidDate: new Date().toISOString(),
      paymentMethod: String(form.paymentMode || "Cash"),
      transactionId: `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
      status: "Paid",
      Status: "Paid",
    };

    try {
      const canUpdate = editingBill && getInvoiceId(editingBill) && getServiceBillType(editingBill) === "consultation";
      const data = canUpdate
        ? await updateBillingBill(editingBill, body)
        : await requestJson(getBillingApiPath("op"), {
            method: "POST",
            body: JSON.stringify(body),
          });

      const invoiceData = Array.isArray(data) ? data[0] : data;
      const fallbackOpInvoiceNo = createInvoiceNo("OP");
      const opInvoiceNo =
        invoiceData?.invoiceNo ||
        invoiceData?.invoiceNumber ||
        invoiceData?.billNumber ||
        editingBill?.invoiceNo ||
        editingBill?.invoiceNumber ||
        editingBill?.billNumber ||
        fallbackOpInvoiceNo;
      const nextInvoice = {
        ...(invoiceData || {}),
        ...(canUpdate ? editingBill : {}),
        ...body,
        invoiceNo: opInvoiceNo,
        invoiceNumber: opInvoiceNo,
        billNumber: opInvoiceNo,
        consultationCharge,
        consultationCharges: consultationCharge,
        medicineCharge: 0,
        medicineCharges: 0,
        labCharge: 0,
        labCharges: 0,
        subtotal,
        discountPercentage,
        discountPercent: discountPercentage,
        discountAmount: discount,
        taxableAmount,
        cgstAmount: 0,
        sgstAmount: 0,
        gstAmount: 0,
        totalAmount,
        grandTotal: totalAmount,
        netAmount: totalAmount,
        payableAmount: totalAmount,
        paymentAmount: totalAmount,
        paidAmount: totalAmount,
        amount: totalAmount,
        revenue: totalAmount,
        billingType: "OP",
        BillingType: "OP",
        invoiceType: "op",
        InvoiceType: "op",
        serviceType: "OP Billing",
        ServiceType: "OP Billing",
        patientName:
          invoiceData?.patientName ||
          getAppointmentPatientName(selectedAppointment),
        doctorName:
          invoiceData?.doctorName ||
          getAppointmentDoctorName(selectedAppointment),
        paymentStatus: "Paid",
        PaymentStatus: "Paid",
        paidDate: invoiceData?.paidDate || invoiceData?.PaidDate || editingBill?.paidDate || new Date().toISOString(),
        paymentMethod: String(form.paymentMode || "Cash"),
        transactionId: invoiceData?.transactionId || invoiceData?.TransactionId || editingBill?.transactionId || `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
        backendSynced: true,
      };
      setInvoice(nextInvoice);
      storeLatestInvoice(nextInvoice);
      setRecentServiceBills((prev) =>
        mergeRecentServiceBills([nextInvoice], storeRecentServiceBill(nextInvoice), prev)
      );
      setEditingBill(null);
      const text = invoiceData?.message || `Bill ${canUpdate ? "updated" : "generated"} successfully`;
      showMessage(text, "success", { autoHide: true });
      downloadInvoicePdf(nextInvoice, invoiceWindow);
    } catch (error) {
      if (invoiceWindow) invoiceWindow.close();
      showMessage(error.message, "error");
      toast.error(error.message || "Unable to generate invoice.");
      setInvoice(null);
    }
  };

  const addSelectedServiceItem = (value) => {
    const normalizedValue = String(value || "").trim().toLowerCase();
      const matched =
      activePriceList.find(
        (item) =>
          getPriceListItemName(item).toLowerCase() === normalizedValue ||
          String(item.diagnosis || "").trim().toLowerCase() === normalizedValue
      ) || null;

    if (!matched) return false;

    const setter = billingMode === "pharmacy" ? setPharmacyRows : setDiagnosticRows;
    setter((rows) => [...rows, createBillingRow([matched])]);
    setServiceSearch("");
    return true;
  };

  const updateServiceSearch = (value) => {
    setServiceSearch(value);
    addSelectedServiceItem(value);
  };

  const removeServiceRow = (rowId) => {
    const setter = billingMode === "pharmacy" ? setPharmacyRows : setDiagnosticRows;
    setter((rows) => rows.filter((row) => row.id !== rowId));
  };

  const updatePharmacyQuantity = (rowId, value) => {
    const quantity = Math.max(1, Number.parseInt(value, 10) || 1);
    setPharmacyRows((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, quantity } : row))
    );
  };

  const updateServiceUnitPrice = (rowId, value) => {
    const amount = Math.max(0, Number(value) || 0);
    const setter = billingMode === "pharmacy" ? setPharmacyRows : setDiagnosticRows;
    setter((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, unitPrice: amount, price: amount } : row))
    );
  };

  const viewRecentServiceBill = (bill) => {
    const billType = getServiceBillType(bill);
    const savedBillAmount = getSavedBillAmount(bill, readAmount(bill, AMOUNT_KEYS.total, 0));
    if (billType === "consultation") {
      setInvoice(bill);
      downloadInvoicePdf(bill);
      return;
    }

    let normalizedRows = normalizeServiceBillRows(bill, billType === "pharmacy" ? "pharmacy" : "diagnostic");
    if (!normalizedRows.length) {
      const fallbackAmount =
        savedBillAmount ||
        (billType === "pharmacy"
          ? readAmount(bill, AMOUNT_KEYS.medicine, 0) || readAmount(bill, AMOUNT_KEYS.total, 0)
          : readAmount(bill, AMOUNT_KEYS.lab, 0) || readAmount(bill, AMOUNT_KEYS.total, 0));
      if (fallbackAmount > 0) {
        normalizedRows = [{
          id: `${billType}-fallback-${getInvoiceId(bill) || Date.now()}`,
          diagnosis: billType === "pharmacy" ? "Pharmacy" : "Lab",
          item: billType === "pharmacy" ? "Pharmacy Charges" : "Diagnostic Charges",
          unitPrice: getTaxableFromGstTotal(fallbackAmount),
          quantity: 1,
        }];
      }
    }
    const rowTotals = getBillingTotals(
      normalizedRows.map((row) => ({
        ...row,
        quantity: billType === "pharmacy" ? row.quantity : 1,
      })),
      readDiscountPercent(bill, readAmount(bill, ["grossTotal", "GrossTotal", "subtotal", "Subtotal", "totalAmount", "TotalAmount"], 0))
    );
    const storedTotals = bill.totals && typeof bill.totals === "object" ? bill.totals : {};
    const grossTotal = savedBillAmount > 0 && normalizedRows.length === 1 ? savedBillAmount : Number(storedTotals.grossTotal ?? rowTotals.grossTotal);
    const finalTotal = savedBillAmount || Number(storedTotals.total ?? rowTotals.total);
    const totals = {
      ...rowTotals,
      ...storedTotals,
      grossTotal,
      total: finalTotal,
      discountAmount: Math.max(0, Number(storedTotals.discountAmount ?? rowTotals.discountAmount ?? 0)),
    };

    printServiceInvoice({
      type: billType === "pharmacy" ? "pharmacy" : "diagnostic",
      invoiceNo: bill.invoiceNo || bill.invoiceNumber || bill.billNumber,
      rows: normalizedRows,
      totals,
      patientName: bill.patientName || bill.PatientName || bill.patient?.name,
      patientId: bill.patientId || bill.PatientId || bill.patient?.id,
      patientPhone: bill.patientPhone || bill.PatientPhone || bill.phone || bill.Phone || bill.patient?.phone,
      patientAge: bill.patientAge || bill.PatientAge || bill.age || bill.Age || bill.patient?.age,
      patientGender: bill.patientGender || bill.PatientGender || bill.gender || bill.Gender || bill.patient?.gender,
      appointmentId: bill.appointmentId || bill.AppointmentId,
      tokenNumber: bill.tokenNo || bill.TokenNo || bill.tokenNumber || bill.TokenNumber || bill.opNo || bill.OpNo,
      createdAt: bill.createdAt || bill.invoiceDate || bill.billDate,
      doctorName: bill.doctorName || bill.DoctorName || bill.doctor?.name,
      paymentMode: bill.paymentMode || bill.PaymentMode,
      clinicName: bill.clinicName || clinicName,
      clinicId,
      clinicPhone,
      clinicEmail,
      receptionistName: bill.receptionistName || receptionistProfile.name,
      autoPrint: false,
    });
  };

  const editRecentServiceBill = (bill) => {
    if (!canEditBill) {
      showMessage("You do not have permission to edit bills.", "error");
      toast.error("You do not have permission to edit bills.");
      return;
    }
    const nextMode = getServiceBillType(bill);
    setEditingBill(bill);
    if (nextMode === "consultation") {
      setBillingMode("consultation");
      setForm((prev) => ({
        ...prev,
        appointmentId: bill.appointmentId ? String(bill.appointmentId) : prev.appointmentId,
        paymentMode: bill.paymentMode || prev.paymentMode,
        medicineCharges: formatAmountInput(readAmount(bill, AMOUNT_KEYS.medicine, 0), { emptyValue: "" }),
        labCharges: formatAmountInput(readAmount(bill, AMOUNT_KEYS.lab, 0), { emptyValue: "" }),
        discount: formatAmountInput(
          readDiscountPercent(
            bill,
            readAmount(bill, ["subtotal", "Subtotal", "grossTotal", "GrossTotal"], 0) ||
              readAmount(bill, AMOUNT_KEYS.total, 0) + readAmount(bill, ["discount", "Discount", "discountAmount", "DiscountAmount"], 0)
          ),
          { emptyValue: "0" }
        ),
      }));
      showMessage("OP bill loaded for editing. Submit again to generate the updated invoice.", "success", { autoHide: true });
      return;
    }

    const normalizedRows = normalizeServiceBillRows(bill, nextMode === "pharmacy" ? "pharmacy" : "diagnostic");

    setBillingMode(nextMode === "pharmacy" ? "pharmacy" : "diagnostic");
    if (nextMode === "pharmacy") {
      setPharmacyRows(normalizedRows);
    } else {
      setDiagnosticRows(normalizedRows);
    }
    setForm((prev) => ({
      ...prev,
      appointmentId: bill.appointmentId ? String(bill.appointmentId) : prev.appointmentId,
      paymentMode: bill.paymentMode || prev.paymentMode,
      discount: formatAmountInput(
        readDiscountPercent(
          bill,
          readAmount(bill, ["grossTotal", "GrossTotal", "subtotal", "Subtotal", "totalAmount", "TotalAmount"], 0)
        ),
        { emptyValue: "0" }
      ),
    }));
    showMessage("Bill loaded for editing. Submit again to generate the updated invoice.", "success", { autoHide: true });
  };

  const deleteRecentServiceBill = async (bill) => {
    if (!canDeleteBill) {
      showMessage("You do not have permission to delete bills.", "error");
      toast.error("You do not have permission to delete bills.");
      return;
    }
    const billId = getInvoiceId(bill);
    if (!billId) {
      showMessage("Bill id is not available for delete.", "error");
      toast.error("Bill id is not available for delete.");
      return;
    }

    const confirmed = window.confirm("Delete this bill permanently?");
    if (!confirmed) return;

    try {
      await deleteBillingBill(bill);
      const nextStoredBills = removeRecentServiceBill(bill);
      setRecentServiceBills((prev) =>
        mergeRecentServiceBills(
          prev.filter((item) => String(getInvoiceId(item)) !== String(billId)),
          nextStoredBills
        )
      );
      if (String(getInvoiceId(invoice)) === String(billId)) {
        setInvoice(null);
      }
      if (String(getInvoiceId(editingBill)) === String(billId)) {
        setEditingBill(null);
      }
      showMessage("Bill deleted successfully.", "success", { autoHide: true });
      toast.success("Bill deleted successfully.");
    } catch (error) {
      showMessage(error.message || "Unable to delete bill.", "error");
      toast.error(error.message || "Unable to delete bill.");
    }
  };

  const setField = (name, value) => {
    const isAmountField = ["medicineCharges", "labCharges", "discount"].includes(name);
    const nextValue = ["medicineCharges", "labCharges", "discount"].includes(name)
      ? onlyNumberValue(value)
      : value;

    if (isAmountField && amountFormatTimers.current[name]) {
      window.clearTimeout(amountFormatTimers.current[name]);
    }

    setForm((prev) => ({ ...prev, [name]: nextValue }));
    setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    setMessage("");
    setMessageType("");
    clearMessageTimer();

    if (isAmountField && nextValue && !String(nextValue).endsWith(".")) {
      amountFormatTimers.current[name] = window.setTimeout(() => {
        formatAmountField(name);
      }, 500);
    }
  };

  const formatAmountField = (name) => {
    if (amountFormatTimers.current[name]) {
      window.clearTimeout(amountFormatTimers.current[name]);
    }

    setForm((prev) => ({
      ...prev,
      [name]: formatAmountInput(prev[name], { emptyValue: "" }),
    }));
  };

  const downloadInvoicePdf = (invoiceOverride = invoice, targetWindow = null) => {
    const activeInvoice = invoiceOverride || invoice;
    if (!activeInvoice) return;

    const invoiceNumber = getInvoiceNumber(activeInvoice);
    const patientName = activeInvoice.patientName || getAppointmentPatientName(selectedAppointment);
    const patientId =
      activeInvoice.patientId ||
      activeInvoice.PatientId ||
      getAppointmentPatientId(selectedAppointment);
    const patientPhone =
      activeInvoice.patientPhone ||
      activeInvoice.PatientPhone ||
      activeInvoice.phone ||
      activeInvoice.Phone ||
      getAppointmentPatientPhone(selectedAppointment);
    const patientAge =
      activeInvoice.patientAge ||
      activeInvoice.PatientAge ||
      activeInvoice.age ||
      activeInvoice.Age ||
      getAppointmentPatientAge(selectedAppointment);
    const patientGender =
      activeInvoice.patientGender ||
      activeInvoice.PatientGender ||
      activeInvoice.gender ||
      activeInvoice.Gender ||
      getAppointmentPatientGender(selectedAppointment);
    const doctorName = activeInvoice.doctorName || getAppointmentDoctorName(selectedAppointment);
    const status = getInvoiceStatus(activeInvoice);
    const paymentMode = activeInvoice.paymentMode || form.paymentMode || "-";
    const appointmentId = activeInvoice.appointmentId || form.appointmentId || "-";
    const tokenNumber =
      activeInvoice.tokenNo ||
      activeInvoice.TokenNo ||
      activeInvoice.tokenNumber ||
      activeInvoice.TokenNumber ||
      getAppointmentTokenNumber(selectedAppointment);
    const visitType =
      activeInvoice.visitType ||
      activeInvoice.VisitType ||
      selectedAppointment?.visitType ||
      selectedAppointment?.VisitType ||
      "Normal";
    const department =
      activeInvoice.departmentName ||
      activeInvoice.DepartmentName ||
      selectedAppointment?.departmentName ||
      selectedAppointment?.DepartmentName ||
      selectedAppointment?.doctor?.department ||
      selectedAppointment?.Doctor?.Department ||
      "-";
    const invoiceDate = formatInvoiceDate(getInvoiceDate(activeInvoice));
    const printDate = new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const branding = getClinicInvoiceBranding({ clinicId, clinicName });
    const logoUrl = branding.logoUrl;
    const headerTitle = branding.headerTitle || clinicName;
    const headerSubtitle = branding.headerSubtitle || "Clinic Management System";
    const footerNote = branding.footerNote;
    const accentColor = branding.accentColor || "#12a4a1";
    const invoiceAmounts = getInvoiceAmounts({
      invoice: activeInvoice,
      form,
      selectedAppointment,
      total,
    });
    const savedOpTotal = getSavedBillAmount(activeInvoice, 0);
    const opCharge =
      readAmount(activeInvoice, AMOUNT_KEYS.consultation, 0) ||
      readAmount(activeInvoice, ["subtotal", "Subtotal"], 0) ||
      readAmount(activeInvoice, AMOUNT_KEYS.total, invoiceAmounts.total);
    const discountPercent = readDiscountPercent(activeInvoice, opCharge);
    const discount = readAmount(
      activeInvoice,
      ["discountAmount", "DiscountAmount", "discount", "Discount"],
      getDiscountAmount(opCharge, discountPercent)
    );
    const opRows = [
      { label: "OP Consultation Charges", amount: opCharge },
      { label: `Discount (${discountPercent}%)`, amount: -discount },
    ];
    const opTotal = savedOpTotal || Math.max(0, opRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));

    const printWindow = targetWindow || window.open("", "_blank", "width=860,height=980");
    if (!printWindow) {
      const text = "Please allow popups to download the invoice PDF.";
      showMessage(text, "error");
      toast.error(text);
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Invoice ${escapeHtml(invoiceNumber)}</title>
          <style>
            @page {
              margin: 16mm;
              size: A4;
            }
            body {
              margin: 0;
              background: #edf5f7;
              color: #0f172a;
              font-family: Arial, Helvetica, sans-serif;
            }
            .invoice {
              max-width: 820px;
              margin: 0 auto;
              background: #ffffff;
              min-height: calc(100vh - 64px);
              padding: 34px;
              box-sizing: border-box;
              position: relative;
              overflow: hidden;
            }
            .invoice > *:not(.watermark) {
              position: relative;
              z-index: 1;
            }
            .watermark {
              position: absolute;
              inset: 0;
              display: grid;
              place-items: center;
              pointer-events: none;
              z-index: 0;
            }
            .watermark img {
              width: 390px;
              height: 390px;
              object-fit: contain;
              opacity: .18;
              filter: saturate(1.35) contrast(1.08);
            }
            .brand-row {
              display: flex;
              justify-content: space-between;
              gap: 22px;
              padding-bottom: 24px;
              border-bottom: 3px solid ${escapeHtml(accentColor)};
            }
            .brand {
              display: flex;
              gap: 14px;
              align-items: center;
            }
            .brand img {
              width: 54px;
              height: 54px;
              border-radius: 14px;
              object-fit: contain;
              background: #e9fbfb;
              padding: 8px;
            }
            .brand h1 {
              margin: 0;
              font-size: 25px;
              line-height: 1.15;
              color: #071120;
            }
            .brand p,
            .invoice-id p,
            .foot-note {
              margin: 5px 0 0;
              color: #536273;
              font-size: 12px;
              line-height: 1.5;
            }
            .invoice-id {
              text-align: right;
              min-width: 190px;
            }
            .invoice-id span {
              display: inline-block;
              padding: 6px 10px;
              border-radius: 999px;
              background: #ecfeff;
              color: #0f8f8d;
              font-size: 11px;
              font-weight: 800;
              letter-spacing: .5px;
              text-transform: uppercase;
            }
            .invoice-id strong {
              display: block;
              margin-top: 10px;
              font-size: 24px;
              color: #071120;
            }
            .details {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 14px;
              margin: 26px 0;
            }
            .reference-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 10px;
              margin-top: 18px;
            }
            .reference {
              border: 1px solid #d9e5ea;
              border-radius: 10px;
              padding: 10px 12px;
              background: #fbfdff;
            }
            .reference span {
              display: block;
              color: #66778a;
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: .35px;
            }
            .reference strong {
              display: block;
              margin-top: 4px;
              color: #111827;
              font-size: 13px;
              line-height: 1.35;
            }
            .panel {
              border: 1px solid #d9e5ea;
              border-radius: 12px;
              padding: 16px;
              background: #fbfdff;
            }
            .panel h2 {
              margin: 0 0 14px;
              font-size: 13px;
              color: #0f172a;
              text-transform: uppercase;
              letter-spacing: .6px;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 10px 14px;
            }
            .info span {
              display: block;
              color: #66778a;
              font-size: 11px;
              margin-bottom: 4px;
              text-transform: uppercase;
              letter-spacing: .35px;
            }
            .info strong {
              color: #111827;
              font-size: 14px;
              line-height: 1.35;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              overflow: hidden;
              border-radius: 12px;
              border: 1px solid #d9e5ea;
            }
            th,
            td {
              padding: 14px 16px;
              border-bottom: 1px solid #e4edf2;
              text-align: left;
              font-size: 14px;
            }
            th {
              background: #071120;
              color: #ffffff;
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: .5px;
            }
            td:last-child,
            th:last-child {
              text-align: right;
            }
            tbody tr:last-child td {
              border-bottom: 0;
            }
            .total {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-top: 20px;
              padding: 18px 20px;
              border-radius: 14px;
              background: #071120;
              color: #ffffff;
              font-size: 22px;
              font-weight: 800;
            }
            .payment {
              display: flex;
              justify-content: space-between;
              gap: 14px;
              margin-top: 18px;
              padding: 14px 16px;
              border: 1px dashed #9ec8ce;
              border-radius: 12px;
              color: #334155;
              font-size: 13px;
            }
            .footer {
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              gap: 24px;
              margin-top: 34px;
              padding-top: 18px;
              border-top: 1px solid #d9e5ea;
            }
            .signature {
              min-width: 170px;
              text-align: center;
              color: #0f172a;
              font-weight: 800;
              font-size: 13px;
            }
            .signature::before {
              content: "";
              display: block;
              border-top: 1px solid #8ba0b4;
              margin-bottom: 8px;
            }
            @media print {
              body {
                background: #ffffff;
              }
              .invoice {
                min-height: auto;
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          <main class="invoice">
            <div class="watermark"><img src="${escapeHtml(logoUrl)}" alt="" /></div>
            <div style="position: absolute; top: 22px; right: 28px; border: 3px double #10b981; border-radius: 6px; padding: 4px 14px; color: #059669; font-size: 20px; font-weight: 900; letter-spacing: 2.5px; transform: rotate(-6deg); background: rgba(16,185,129,0.08); text-transform: uppercase; z-index: 10; pointer-events: none;">
              PAID
            </div>
            <section class="brand-row">
              <div class="brand">
                <img src="${escapeHtml(logoUrl)}" alt="Clinic logo" />
                <div>
                  <h1>${escapeHtml(headerTitle)}</h1>
                  <p>${escapeHtml([headerSubtitle, clinicId ? `Clinic ID: ${clinicId}` : "", clinicPhone, clinicEmail].filter(Boolean).join(" | "))}</p>
                </div>
              </div>
              <div class="invoice-id">
                <span>OP Billing Invoice</span>
                <strong>${escapeHtml(invoiceNumber)}</strong>
                <p>${escapeHtml(invoiceDate)}</p>
              </div>
            </section>

            <section class="reference-grid">
              <div class="reference"><span>OP / Cons No</span><strong>${escapeHtml(invoiceNumber)}</strong></div>
              <div class="reference"><span>Appointment ID</span><strong>${escapeHtml(appointmentId)}</strong></div>
              <div class="reference"><span>Token No</span><strong>${escapeHtml(tokenNumber)}</strong></div>
              <div class="reference"><span>Print Date</span><strong>${escapeHtml(printDate)}</strong></div>
            </section>

            <section class="details">
              <div class="panel">
                <h2>Patient Details</h2>
                <div class="info-grid">
                  <div class="info"><span>Patient</span><strong>${escapeHtml(patientName)}</strong></div>
                  <div class="info"><span>Patient ID</span><strong>${escapeHtml(patientId)}</strong></div>
                  <div class="info"><span>Phone</span><strong>${escapeHtml(patientPhone)}</strong></div>
                  <div class="info"><span>Age / Gender</span><strong>${escapeHtml([patientAge, patientGender].filter((item) => item && item !== "-").join(" / ") || "-")}</strong></div>
                </div>
              </div>
              <div class="panel">
                <h2>Billing Details</h2>
                <div class="info-grid">
                  <div class="info"><span>Consultant</span><strong>${escapeHtml(doctorName)}</strong></div>
                  <div class="info"><span>Department</span><strong>${escapeHtml(department)}</strong></div>
                  <div class="info"><span>Visit Type</span><strong>${escapeHtml(visitType)}</strong></div>
                  <div class="info"><span>Status</span><strong>${escapeHtml(status)}</strong></div>
                  <div class="info"><span>Payment Mode</span><strong>${escapeHtml(paymentMode)}</strong></div>
                  <div class="info"><span>Generated By</span><strong>${escapeHtml(receptionistProfile.name || "Reception")}</strong></div>
                  <div class="info"><span>Created Date</span><strong>${escapeHtml(invoiceDate)}</strong></div>
                </div>
              </div>
            </section>

            <table>
              <thead>
                <tr><th>Description</th><th>Amount</th></tr>
              </thead>
              <tbody>
                ${opRows
                  .map((row) => `
                    <tr>
                      <td>${escapeHtml(row.label)}</td>
                      <td>${escapeHtml(formatCurrency(row.amount))}</td>
                    </tr>
                  `)
                  .join("")}
              </tbody>
            </table>

            <div class="total"><span>Total</span><span>${escapeHtml(formatCurrency(opTotal))}</span></div>

            <div class="payment">
              <span>Payment received via <strong>${escapeHtml(paymentMode)}</strong></span>
              <span>Status: <strong>${escapeHtml(status)}</strong></span>
            </div>

            <section class="footer">
              <p class="foot-note">${escapeHtml(footerNote)}</p>
              <div class="signature">Authorized Signature</div>
            </section>
          </main>
          <script>
            window.onload = () => {
              window.print();
              window.onafterprint = () => window.close();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const activeBill = editingBill || invoice;
  const activePaymentStatus = activeBill
    ? firstValue(activeBill.paymentStatus, activeBill.PaymentStatus, activeBill.status, activeBill.Status) || "Paid"
    : null;

  const showPaidStamp = activePaymentStatus === "Paid";

  const activePaidDate = activeBill
    ? firstValue(activeBill.paidDate, activeBill.PaidDate, activeBill.createdAt, activeBill.billDate, activeBill.invoiceDate) || new Date().toISOString()
    : new Date().toISOString();

  const activePaymentMethod = activeBill
    ? firstValue(activeBill.paymentMethod, activeBill.PaymentMethod, activeBill.paymentMode, activeBill.PaymentMode, form.paymentMode) || "Cash"
    : form.paymentMode || "Cash";

  const activeTransactionId = activeBill
    ? firstValue(activeBill.transactionId, activeBill.TransactionId) || ""
    : "";

  const opConsultationCharge = useMemo(() => {
    if (editingBill) {
      return readAmount(editingBill, AMOUNT_KEYS.consultation, 0) || readAmount(editingBill, AMOUNT_KEYS.total, 500);
    }
    if (invoice && billingMode === "consultation") {
      return readAmount(invoice, AMOUNT_KEYS.consultation, 0) || readAmount(invoice, AMOUNT_KEYS.total, 500);
    }
    const fromApt = Number(
      firstValue(
        selectedAppointment?.consultationFee,
        selectedAppointment?.ConsultationFee,
        selectedAppointment?.doctorFee,
        selectedAppointment?.DoctorFee,
        getAppointmentPaidAmount(selectedAppointment),
        500
      )
    );
    return Number.isFinite(fromApt) && fromApt > 0 ? fromApt : 500;
  }, [editingBill, invoice, billingMode, selectedAppointment]);

  const opMedicineCharge = Number(form.medicineCharges || 0);
  const opLabCharge = Number(form.labCharges || 0);
  const opServiceCharges = opMedicineCharge + opLabCharge;

  const opSubtotal = opConsultationCharge + opServiceCharges;
  const opDiscountPercent = normalizeDiscountPercent(form.discount);
  const opDiscountAmount = getDiscountAmount(opSubtotal, opDiscountPercent);
  const opTaxableAmount = Math.max(0, opSubtotal - opDiscountAmount);
  const opTaxAmount = 0;
  const opTotalAmount = opTaxableAmount;

  return (
    <section className="rc-page">
      <div className="rc-page-head">
        <div>
          <h2>Billing</h2>
          <p>View OP invoices and create diagnostic/pharmacy invoices from persisted backend billing records.</p>
        </div>
        <button className="rc-btn" onClick={() => navigate("/reception/dashboard")}>
          <ArrowLeft size={16} /> Dashboard
        </button>
      </div>

      {message ? <div className={`rc-alert ${messageType}`}>{message}</div> : null}

      <div className="rc-billing-tabs" role="tablist" aria-label="Billing module">
        {[
          ["consultation", "OP Billing"],
          ["diagnostic", "Diagnosis Test Billing"],
          ["pharmacy", "Pharmacy Billing"],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={billingMode === mode ? "active" : ""}
            onClick={() => {
              setBillingMode(mode);
              setMessage("");
              setMessageType("");
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rc-billing-layout">
        {billingMode === "consultation" ? null : (
        <form className="rc-card rc-billing-form" onSubmit={generate} noValidate>
          <div className="rc-billing-card-head">
            <div>
              <h3>
                {billingMode === "pharmacy"
                  ? "Generate Pharmacy Bill"
                  : "Generate Diagnosis Test Bill"}
              </h3>
              <p>
                {billingMode === "pharmacy"
                  ? "Load medicines from the doctor's prescription and collect pharmacy payment."
                  : "Load prescribed diagnostic tests and collect payment."}
              </p>
            </div>
          </div>
        {selectedAppointment ? (
          <div className="rc-patient-summary">
            <strong>
              {getAppointmentPatientName(selectedAppointment)}
            </strong>
            <span>
              {getAppointmentPatientId(selectedAppointment)} |{" "}
              {getAppointmentDoctorName(selectedAppointment)}
            </span>
          </div>
        ) : null}
        <div className="rc-billing-fields">
          <label className="rc-field-wide">
            <span>{billingMode === "consultation" ? "Appointment" : "Booked Appointment"}</span>
            <select
              value={form.appointmentId}
              onChange={(e) => setField("appointmentId", e.target.value)}
              className={billingMode === "consultation" && fieldErrors.appointmentId ? "is-invalid" : ""}
            >
              <option value="">
                {billingMode === "diagnostic"
                  ? "Manual / walk-in diagnostic billing"
                  : "Manual / walk-in billing"}
              </option>
              {filteredBillingAppointments.length === 0 ? (
                <option value="">
                  {billingMode === "diagnostic" ? "No submitted diagnostic requests found" : "No booked appointments found"}
                </option>
              ) : null}
              {filteredBillingAppointments.map((a) => (
                <option value={getAppointmentId(a)} key={getAppointmentId(a)}>
                  {getAppointmentPatientName(a)} - {formatInvoiceDate(getAppointmentDate(a))} - {getAppointmentTime(a)} -{" "}
                  {getAppointmentStatus(a) || "-"}
                </option>
              ))}
            </select>
            {billingMode === "consultation" && fieldErrors.appointmentId ? <small className="rc-field-error">{fieldErrors.appointmentId}</small> : null}
          </label>
          <div className="rc-field-wide rc-billing-appointment-tools">
            <div className="rc-patient-list-tabs" role="tablist" aria-label="Billing appointment list view">
              <button
                type="button"
                className={appointmentListView === "today" ? "active" : ""}
                onClick={() => setAppointmentListView("today")}
                role="tab"
                aria-selected={appointmentListView === "today"}
              >
                <CalendarDays size={16} /> Today
                <span>{todayBillingAppointmentCount}</span>
              </button>
              <button
                type="button"
                className={appointmentListView === "past" ? "active" : ""}
                onClick={() => setAppointmentListView("past")}
                role="tab"
                aria-selected={appointmentListView === "past"}
              >
                <History size={16} /> Past
                <span>{pastBillingAppointmentCount}</span>
              </button>
            </div>
            <label className="rc-filter-field">
              <span>Appointment Date</span>
              <input
                type="date"
                value={appointmentDateFilter}
                onChange={(event) => setAppointmentDateFilter(event.target.value)}
              />
            </label>
            <button type="button" className="rc-btn ghost" onClick={() => setAppointmentDateFilter("")}>
              Clear Date
            </button>
          </div>
        <label>
          <span>Payment Mode</span>
          <select
            value={form.paymentMode}
            onChange={(e) => setField("paymentMode", e.target.value)}
            className={fieldErrors.paymentMode ? "is-invalid" : ""}
          >
            <option value="UPI">UPI</option>
            <option value="Cash">Cash</option>
            <option value="Card">Card</option>
          </select>
          {fieldErrors.paymentMode ? <small className="rc-field-error">{fieldErrors.paymentMode}</small> : null}
        </label>
        {billingMode === "consultation" ? (
          <>
            <label>
              <span>Medicine Charges</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.medicineCharges}
                placeholder="0.00"
                onChange={(e) => setField("medicineCharges", e.target.value)}
                onBlur={() => formatAmountField("medicineCharges")}
                className={`rc-amount-input ${fieldErrors.medicineCharges ? "is-invalid" : ""}`}
              />
              {fieldErrors.medicineCharges ? <small className="rc-field-error">{fieldErrors.medicineCharges}</small> : null}
            </label>
            <label>
              <span>Lab Charges</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.labCharges}
                placeholder="0.00"
                onChange={(e) => setField("labCharges", e.target.value)}
                onBlur={() => formatAmountField("labCharges")}
                className={`rc-amount-input ${fieldErrors.labCharges ? "is-invalid" : ""}`}
              />
              {fieldErrors.labCharges ? <small className="rc-field-error">{fieldErrors.labCharges}</small> : null}
            </label>
          </>
        ) : null}
        </div>
        {billingMode !== "consultation" ? (
          <div className="rc-service-billing">
            <div className="rc-service-head">
              <strong>{billingMode === "pharmacy" ? "Medicine Items" : "Diagnostic Test Items"}</strong>
            </div>
            {billingMode === "diagnostic" ? (
              <label className="rc-service-picker">
                <span>Test Name</span>
                <input
                  value={serviceSearch}
                  list={`${billingMode}-billing-items`}
                  placeholder={
                    activePriceList.length
                      ? "Search or select lab test"
                      : labMasterLoading
                        ? "Loading lab tests..."
                        : "No lab file tests available"
                  }
                  onChange={(event) => updateServiceSearch(event.target.value)}
                  disabled={labMasterLoading && !activePriceList.length}
                />
              </label>
            ) : (
              <div className="rc-service-picker">
                <span>Doctor Prescription</span>
                <strong>
                  {pharmacyPrescriptionLoading
                    ? "Loading prescribed medicines..."
                    : selectedAppointment
                      ? pharmacyRows.length
                        ? `${pharmacyRows.length} prescribed medicine(s) loaded. Enter unit price and quantity.`
                        : "No prescribed medicines found for this appointment."
                      : "Select a booked appointment to load prescribed medicines."}
                </strong>
              </div>
            )}
            <div className="rc-service-table">
              <datalist id={`${billingMode}-billing-items`}>
                {activePriceList.map((item, index) => (
                  <option key={`${item.diagnosis}-${getPriceListItemKey(item, index)}`} value={getPriceListItemName(item)} />
                ))}
              </datalist>
              <div className={`rc-service-grid rc-service-grid-head ${billingMode === "diagnostic" ? "is-diagnostic" : ""}`}>
                <span>{billingMode === "pharmacy" ? "Selected Medicine" : "Selected Test"}</span>
                {billingMode === "pharmacy" ? <span>Qty</span> : null}
                <span>Amount</span>
                <span>CGST</span>
                <span>SGST</span>
                <span>Net Amount</span>
                <span />
              </div>
              {activeServiceRows.map((row) => {
                const rowQuantity = billingMode === "pharmacy" ? Number(row.quantity) || 1 : 1;
                const lineAmount = (Number(row.unitPrice) || 0) * rowQuantity;
                const lineCgst = lineAmount * HALF_GST_RATE;
                const lineSgst = lineAmount * HALF_GST_RATE;
                const lineTotal = lineAmount + lineCgst + lineSgst;
                return (
                  <div className={`rc-service-grid ${billingMode === "diagnostic" ? "is-diagnostic" : ""}`} key={row.id}>
                    <strong className="rc-service-item-name">
                      {row.item}
                      {billingMode === "pharmacy" && (row.dosage || row.frequency || row.duration) ? (
                        <small>
                          {[row.dosage, row.frequency, row.duration].filter(Boolean).join(" | ")}
                        </small>
                      ) : null}
                    </strong>
                    {billingMode === "pharmacy" ? (
                      <input
                        className="rc-service-qty"
                        type="number"
                        min="1"
                        value={rowQuantity}
                        onChange={(event) => updatePharmacyQuantity(row.id, event.target.value)}
                        aria-label={`Quantity for ${row.item}`}
                      />
                    ) : null}
                    <input
                      className="rc-service-amount-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={Number(row.unitPrice) || 0}
                      onChange={(event) => updateServiceUnitPrice(row.id, event.target.value)}
                      aria-label={`Amount for ${row.item}`}
                    />
                    <strong>{formatCurrency(lineCgst)}</strong>
                    <strong>{formatCurrency(lineSgst)}</strong>
                    <strong>{formatCurrency(lineTotal)}</strong>
                    <button
                      type="button"
                      className="rc-service-remove-btn"
                      onClick={() => removeServiceRow(row.id)}
                      aria-label="Remove item"
                    >
                      <Minus size={16} />
                    </button>
                  </div>
                );
              })}
              <div className={`rc-service-grid rc-service-total-row ${billingMode === "diagnostic" ? "is-diagnostic" : ""}`}>
                <strong className="rc-service-total-label">Total</strong>
                {billingMode === "pharmacy" ? <span /> : null}
                <strong>{formatCurrency(serviceDisplayTotals.subtotal)}</strong>
                <strong>{formatCurrency(serviceDisplayTotals.cgst)}</strong>
                <strong>{formatCurrency(serviceDisplayTotals.sgst)}</strong>
                <strong>{formatCurrency(serviceDisplayTotals.total)}</strong>
                <span />
              </div>
            </div>
          </div>
        ) : (
          <div className="rc-total">
            <span>Total</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
        )}
        {billingMode !== "consultation" ? (
          <div className="rc-service-actions">
            <button type="button" className="rc-service-preview" onClick={() => openServiceInvoice({ autoPrint: false })}>
              <Eye size={15} /> Preview
            </button>
            <button type="button" className="rc-service-print" onClick={() => openServiceInvoice({ autoPrint: true })}>
              <Printer size={15} /> Print
            </button>
            <button
              className={`rc-confirm ${showPaidStamp ? "is-paid" : ""}`}
              type="submit"
              disabled={showPaidStamp || (editingBill ? !canEditBill : !canCreateBill)}
              onClick={(e) => {
                if (showPaidStamp) {
                  e.preventDefault();
                  const msg = "This bill has already been paid.";
                  showMessage(msg, "info");
                  toast.info(msg);
                }
              }}
            >
              <CheckCircle size={15} /> {showPaidStamp ? "✓ Paid" : "Submit"}
            </button>
          </div>
        ) : (
          <button
            className={`rc-confirm ${showPaidStamp ? "is-paid" : ""}`}
            type="submit"
            disabled={showPaidStamp || (editingBill ? !canEditBill : !canCreateBill)}
            onClick={(e) => {
              if (showPaidStamp) {
                e.preventDefault();
                const msg = "This bill has already been paid.";
                showMessage(msg, "info");
                toast.info(msg);
              }
            }}
          >
            <FileText size={15} /> {showPaidStamp ? "✓ Paid" : "Generate Invoice"}
          </button>
        )}
      </form>
        )}

        <section className="rc-card rc-latest-bills">
          <div className="rc-latest-bills-head">
            <div>
              <h3>Latest Bills</h3>
              <p>
                Submitted{" "}
                {billingMode === "pharmacy"
                  ? "pharmacy"
                  : billingMode === "diagnostic"
                    ? "diagnostic"
                    : "OP"}{" "}
                invoices.
              </p>
            </div>
          </div>
          {visibleRecentServiceBills.length ? (
            <div className="rc-latest-bills-list">
              {visibleRecentServiceBills.map((bill, index) => {
                const billType = getServiceBillType(bill);
                const invoiceNo = bill.invoiceNo || bill.invoiceNumber || bill.billNumber || `BILL-${index + 1}`;
                const amount = getSavedBillAmount(bill, 0);
                const createdAt = bill.createdAt || bill.invoiceDate || bill.billDate;
                const canManageBill = hasBackendBillingId(bill);
                const rawStatus = String(bill.paymentStatus || bill.PaymentStatus || bill.status || bill.Status || "Paid").trim();
                const isCleared = rawStatus.toLowerCase() === "paid";
                return (
                  <article className="rc-latest-bill-row" key={`${invoiceNo}-${index}`}>
                    <div className="rc-latest-bill-pdf">
                      <FileText size={20} />
                    </div>
                    <div className="rc-latest-bill-main">
                      <strong>{bill.patientName || "Walk-in Patient"}</strong>
                      <span>
                        {invoiceNo} | {billType === "pharmacy" ? "Pharmacy" : billType === "diagnostic" ? "Diagnostic" : "OP"} |{" "}
                        {createdAt ? formatInvoiceDate(createdAt) : "Just now"}
                      </span>
                    </div>
                    {isCleared ? (
                      <span className="rc-latest-bill-paid-stamp">PAID</span>
                    ) : (
                      <PaymentStatusBadge status={rawStatus} />
                    )}
                    <b>{formatCurrency(amount)}</b>
                    <div className="rc-latest-bill-actions">
                      <ActionsGroup
                        rowId={invoiceNo}
                        activeActionState={activeActionState}
                        setActiveActionState={setActiveActionState}
                        canView={true}
                        canEdit={canManageBill && canEditBill}
                        canStatus={true}
                        statusChecked={isCleared}
                        canDelete={canManageBill && canDeleteBill}
                        statusTitle={isCleared ? "Bill Cleared / Paid" : "Bill Pending"}
                        onView={() => viewRecentServiceBill(bill)}
                        onEdit={() => editRecentServiceBill(bill)}
                        onStatus={() => viewRecentServiceBill(bill)}
                        onDelete={() => deleteRecentServiceBill(bill)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rc-latest-bills-empty">
              No submitted {billingMode === "pharmacy" ? "pharmacy" : billingMode === "diagnostic" ? "diagnostic" : "OP"} bills yet.
            </div>
          )}
        </section>

      </div>
    </section>
  );
}

export default ReceptionBilling;

