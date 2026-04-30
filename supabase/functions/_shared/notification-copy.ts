const normalize = (value: unknown) => String(value || "").trim();
const toAmount = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};

export const formatNotificationAmount = (
  value: unknown,
  currency = "INR",
): string | null => {
  const amount = toAmount(value);
  if (amount <= 0) return null;

  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const prefix = normalize(currency).toUpperCase() === "INR"
    ? "Rs"
    : normalize(currency).toUpperCase() || "Rs";

  return `${prefix} ${formatted}`;
};

export const formatNotificationRoom = (
  roomNumber: unknown,
  fallback = "booking",
) => {
  const normalizedRoom = normalize(roomNumber);
  return normalizedRoom ? `Room ${normalizedRoom}` : fallback;
};

export const formatNotificationPerson = (
  name: unknown,
  fallback = "Customer",
) => normalize(name) || fallback;

const getPaymentLabel = (paymentType: unknown) => {
  const normalized = normalize(paymentType).toLowerCase();
  if (normalized === "monthly" || normalized === "rent") {
    return "Rent payout";
  }
  return "Advance payout";
};

export const buildPayoutNotificationCopy = (input: {
  paymentType?: unknown;
  customerName?: unknown;
  roomNumber?: unknown;
  amount?: unknown;
  currency?: unknown;
  status: "COMPLETED" | "FAILED";
}) => {
  const payoutLabel = getPaymentLabel(input.paymentType);
  const customerName = formatNotificationPerson(input.customerName);
  const roomLabel = formatNotificationRoom(input.roomNumber);
  const amountText = formatNotificationAmount(input.amount, normalize(input.currency) || "INR");
  const context = `${customerName}, ${roomLabel}`;

  return {
    title: input.status === "COMPLETED" ? `${payoutLabel} received` : `${payoutLabel} failed`,
    message: input.status === "COMPLETED"
      ? `${payoutLabel} of ${amountText || "the amount"} for ${context} received successfully.`
      : `${payoutLabel} of ${amountText || "the amount"} for ${context} failed.`,
  };
};

export const buildRefundCustomerCopy = (input: {
  status: "review_started" | "processing" | "on_hold" | "completed" | "failed" | "rejected";
  roomNumber?: unknown;
  amount?: unknown;
  currency?: unknown;
  failureReason?: unknown;
}) => {
  const roomLabel = formatNotificationRoom(input.roomNumber);
  const amountText = formatNotificationAmount(input.amount, normalize(input.currency) || "INR");
  const refundLine = `Refund${amountText ? ` of ${amountText}` : ""} for ${roomLabel}`;
  const failureReason = normalize(input.failureReason);

  if (input.status === "review_started") {
    return {
      title: "Refund review started",
      message: `${refundLine} is under review.`,
    };
  }

  if (input.status === "processing") {
    return {
      title: "Refund processing",
      message: `${refundLine} is processing.`,
    };
  }

  if (input.status === "on_hold") {
    return {
      title: "Refund on hold",
      message: `${refundLine} is on hold.`,
    };
  }

  if (input.status === "completed") {
    return {
      title: "Refund completed",
      message: `${refundLine} completed successfully.`,
    };
  }

  if (input.status === "rejected") {
    return {
      title: "Refund request rejected",
      message: `${refundLine} was not approved.`,
    };
  }

  return {
    title: "Refund failed",
    message: failureReason
      ? `${refundLine} failed. Reason: ${failureReason}.`
      : `${refundLine} failed.`,
  };
};

export const buildRefundAdjustmentCopy = (input: {
  customerName?: unknown;
  roomNumber?: unknown;
  amount?: unknown;
  currency?: unknown;
}) => {
  const customerName = formatNotificationPerson(input.customerName);
  const roomLabel = formatNotificationRoom(input.roomNumber);
  const amountText = formatNotificationAmount(input.amount, normalize(input.currency) || "INR");

  return {
    title: "Refund adjusted",
    message: `${amountText || "Amount"} deducted from payout for ${customerName}, ${roomLabel}.`,
  };
};

export const buildBookingStatusCopy = (input: {
  kind: "approved" | "rejected" | "checked_in" | "checked_out" | "vacate_approved" | "vacate_requested";
  roomNumber?: unknown;
  amount?: unknown;
  currency?: unknown;
  customerName?: unknown;
  reason?: unknown;
}) => {
  const roomLabel = formatNotificationRoom(input.roomNumber);
  const amountText = formatNotificationAmount(input.amount, normalize(input.currency) || "INR");
  const customerName = formatNotificationPerson(input.customerName, "Resident");
  const reason = normalize(input.reason);

  if (input.kind === "approved") {
    return {
      title: "Booking approved",
      message: amountText
        ? `${roomLabel} booking approved. Payment ${amountText} received.`
        : `${roomLabel} booking approved.`,
    };
  }

  if (input.kind === "rejected") {
    return {
      title: "Booking rejected",
      message: reason
        ? `${roomLabel} booking rejected. Reason: ${reason}.`
        : `${roomLabel} booking rejected.`,
    };
  }

  if (input.kind === "checked_in") {
    return {
      title: "Check-in confirmed",
      message: `Check-in confirmed for ${roomLabel}.`,
    };
  }

  if (input.kind === "checked_out") {
    return {
      title: "Check-out completed",
      message: `Check-out completed for ${roomLabel}.`,
    };
  }

  if (input.kind === "vacate_approved") {
    return {
      title: "Vacate approved",
      message: `Vacate approved for ${roomLabel}.`,
    };
  }

  return {
    title: "Vacate request",
    message: `${customerName} requested vacate for ${roomLabel}.`,
  };
};

export const getBookingNotificationType = (
  kind: "approved" | "rejected" | "checked_in" | "checked_out" | "vacate_approved" | "vacate_requested",
) => {
  if (kind === "approved") {
    return "booking_confirmed";
  }

  if (kind === "rejected") {
    return "booking_rejected";
  }

  return null;
};
