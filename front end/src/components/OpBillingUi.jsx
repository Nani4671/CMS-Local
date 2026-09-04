import React from "react";
import {
  Calendar,
  CalendarDays,
  CheckCircle,
  Eye,
  History,
  Printer,
  X,
} from "lucide-react";
import { PaidStamp, PaymentStatusBadge } from "./PaymentStatus";
import { formatIndianCurrency } from "../utils/format";
import "./OpBillingUi.css";

const formatCurrency = (val) => formatIndianCurrency(val);

export const OpBillingHeader = () => null;

export const PatientDoctorBanner = ({
  patientName = "Walk-in Patient",
  patientId = "OPD-00012345",
  doctorName = "Dr. Priya Sharma",
  doctorDepartment = "General Physician",
}) => {
  return (
    <div className="op-patient-doctor-banner">
      <div className="op-banner-patient">
        <strong>Patient: {patientName}</strong>
        <span>ID: {patientId}</span>
      </div>
      <div className="op-banner-doctor">
        <strong>Doctor: {doctorName}</strong>
        <span>{doctorDepartment}</span>
      </div>
    </div>
  );
};

export const BookedAppointmentField = ({
  appointments = [],
  selectedAppointmentId = "",
  onSelectAppointment,
  fieldError = "",
}) => {
  return (
    <div className="op-form-field">
      <label>Booked Appointment</label>
      <select
        value={selectedAppointmentId}
        onChange={(e) => onSelectAppointment && onSelectAppointment(e.target.value)}
        className={`op-form-select ${fieldError ? "is-invalid" : ""}`}
      >
        <option value="">Manual / walk-in billing (OP Consultation)</option>
        {appointments.map((a) => (
          <option value={a.id} key={a.id}>
            {a.patientName} - {a.date} - {a.time} ({a.doctorName})
          </option>
        ))}
      </select>
      {fieldError ? <small className="rc-field-error">{fieldError}</small> : null}
    </div>
  );
};

export const MiddleToolbarRow = ({
  appointmentListView = "today",
  onTabChange,
  todayCount = 0,
  pastCount = 0,
  appointmentDateFilter = "",
  onDateFilterChange,
  onClearDateFilter,
}) => {
  return (
    <div className="op-middle-toolbar">
      <div className="op-pill-tabs-container">
        <button
          type="button"
          className={`op-pill-tab ${appointmentListView === "today" ? "active" : "inactive"}`}
          onClick={() => onTabChange && onTabChange("today")}
        >
          <CalendarDays size={15} /> Today
          <span className="op-pill-tab-badge">{todayCount}</span>
        </button>
        <button
          type="button"
          className={`op-pill-tab ${appointmentListView === "past" ? "active" : "inactive"}`}
          onClick={() => onTabChange && onTabChange("past")}
        >
          <History size={15} /> Past
          <span className="op-pill-tab-badge">{pastCount}</span>
        </button>
      </div>

      <div className="op-date-clear-group">
        <div className="op-form-field">
          <label>Appointment Date</label>
          <input
            type="date"
            value={appointmentDateFilter}
            onChange={(e) => onDateFilterChange && onDateFilterChange(e.target.value)}
            className="op-form-input"
          />
        </div>
        <button
          type="button"
          className="op-btn-clear-date"
          onClick={onClearDateFilter}
        >
          Clear Date
        </button>
      </div>
    </div>
  );
};

export const PaymentModeDiscountRow = ({
  paymentMode = "Cash",
  onPaymentModeChange,
  discount = "0",
  onDiscountChange,
  onDiscountBlur,
}) => {
  return (
    <div className="op-two-col-grid">
      <div className="op-form-field">
        <label>Payment Mode</label>
        <select
          value={paymentMode}
          onChange={(e) => onPaymentModeChange && onPaymentModeChange(e.target.value)}
          className="op-form-select"
        >
          <option value="UPI">UPI</option>
          <option value="Cash">Cash</option>
          <option value="Card">Card</option>
        </select>
      </div>

      <div className="op-form-field">
        <label>Discount (%)</label>
        <div className="op-discount-wrapper">
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={discount}
            placeholder="0"
            onChange={(e) => onDiscountChange && onDiscountChange(e.target.value)}
            onBlur={onDiscountBlur}
            className="op-form-input"
          />
          <span className="op-discount-symbol">%</span>
        </div>
      </div>
    </div>
  );
};

export const ChargesBreakdownTable = ({
  consultationCharge = 0,
  serviceCharges = 0,
  discountAmount = 0,
  taxAmount = 0,
  totalAmount = 0,
}) => {
  return (
    <div className="op-breakdown-section">
      <strong className="op-breakdown-title">OP Billing Summary</strong>
      
      <div className="op-table-header-row">
        <span>DESCRIPTION</span>
        <span>AMOUNT</span>
        <span>DISCOUNT</span>
        <span>NET AMOUNT</span>
      </div>

      <div className="op-table-body-row">
        <span>OP Consultation Fee</span>
        <span>{formatCurrency(consultationCharge)}</span>
        <span>-{formatCurrency(discountAmount)}</span>
        <span>{formatCurrency(Math.max(0, consultationCharge - discountAmount))}</span>
      </div>

      {serviceCharges > 0 && (
        <div className="op-table-body-row">
          <span>Service / Procedure Charges</span>
          <span>{formatCurrency(serviceCharges)}</span>
          <span>₹0.00</span>
          <span>{formatCurrency(serviceCharges)}</span>
        </div>
      )}

      <div className="op-table-total-row">
        <span>Total</span>
        <span>{formatCurrency(consultationCharge + serviceCharges)}</span>
        <span>-{formatCurrency(discountAmount)}</span>
        <span>{formatCurrency(totalAmount)}</span>
      </div>
    </div>
  );
};

export const ThreeButtonActionBar = ({
  isPaid = false,
  onSubmit,
  onPreview,
  onPrint,
  disabled = false,
}) => {
  return (
    <div className="op-action-buttons-row">
      <button
        type="button"
        className="op-action-btn btn-preview"
        onClick={onPreview}
      >
        <Eye size={16} /> Preview
      </button>

      <button
        type="button"
        className="op-action-btn btn-print"
        onClick={onPrint}
      >
        <Printer size={16} /> Print
      </button>

      <button
        type="submit"
        onClick={onSubmit}
        className={`op-action-btn btn-submit ${isPaid ? "is-paid" : ""}`}
        disabled={disabled}
      >
        <CheckCircle size={16} /> {isPaid ? "✓ Paid" : "Submit"}
      </button>
    </div>
  );
};

/* Compatibility wrapper exports */
export const ChargeCardsGrid = (props) => null;
export const SummaryCardsRow = (props) => null;
export const TotalAmountCard = (props) => null;
export const PaymentActionButton = (props) => null;
export const BottomInfoCards = (props) => null;
export const VisitInfoRow = (props) => null;
export const PatientDoctorCard = (props) => null;
