import React from "react";

export const formatPaidDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sept",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedHours = String(hours).padStart(2, "0");

  return `${day} ${month} ${year}, ${formattedHours}:${minutes} ${ampm}`;
};

export const PaymentStatusBadge = ({ status = "Paid", className = "" }) => {
  const normalizedStatus = String(status || "Paid").trim();
  const key = normalizedStatus.toLowerCase();

  let statusClass = "rc-status-badge-paid";
  let displayLabel = "PAID";

  if (key === "pending") {
    statusClass = "rc-status-badge-pending";
    displayLabel = "PENDING";
  } else if (key === "partial") {
    statusClass = "rc-status-badge-partial";
    displayLabel = "PARTIAL";
  } else if (key === "cancelled" || key === "canceled") {
    statusClass = "rc-status-badge-cancelled";
    displayLabel = "CANCELLED";
  }

  return (
    <span className={`rc-status-badge ${statusClass} ${className}`.trim()}>
      {displayLabel}
    </span>
  );
};

export const PaidStamp = () => null;

export const PaymentDetails = ({
  paymentStatus = "Paid",
  paidDate,
  paymentMethod,
  transactionId,
}) => {
  if (paymentStatus !== "Paid") return null;

  const formattedDate = paidDate
    ? formatPaidDateTime(paidDate)
    : formatPaidDateTime(new Date());

  return (
    <div className="rc-payment-details">
      <div>
        <strong>Status:</strong> <PaymentStatusBadge status={paymentStatus} />
      </div>
      <div>
        <strong>Paid Date:</strong> {formattedDate}
      </div>
      {paymentMethod && (
        <div>
          <strong>Method:</strong> {paymentMethod}
        </div>
      )}
      {transactionId && (
        <div>
          <strong>Txn ID:</strong> {transactionId}
        </div>
      )}
    </div>
  );
};

export default PaymentStatusBadge;
