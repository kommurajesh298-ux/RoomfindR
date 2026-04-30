# Owner Bookings Management Guide

This guide describes the booking workflow and management features available in the Owner App.

## 1. Booking Workflow

### Pending Requests
When a customer requests a booking, it appears in the **Requests** tab. You can:
- **Accept**: If the customer has paid the advance, you can accept the booking. This moves it to the **Accepted** tab.
- **Reject**: You must provide a reason (e.g., "Room unavailable"). The customer will be notified.

### Check-In
Once a booking is accepted and the start date arrives, the **Mark as Checked-In** button becomes active.
- Clicking this updates the booking status to **Active**.
- It automatically increments the room's occupant count and updates the property's total vacancy count.

### Check-Out
When the customer's stay ends, use the **Mark as Checked-Out** button.
- Status changes to **History**.
- Room occupancy decrements, and vacancy increases automatically.

## 2. Communication

### Real-time Chat
Click the **Chat** button on any booking card to open a direct conversation with the customer.

### Broadcast Notifications
Use the **Broadcast** button at the top of the Bookings page to send announcements (like "Food service update" or "Maintenance alert") to all customers currently checked into a specific property.

## 3. Vacancy Management

### Manual Adjustments
The **Vacancy Manager** tool allows you to manually adjust the number of occupants in each room. This is useful for:
- Manual walk-in bookings not made through the app.
- Correcting discrepancies in occupancy.

> [!IMPORTANT]
> Manual adjustments instantly update the customer-facing vacancy counts on the platform.

## 4. Troubleshooting

- **Cannot Accept Booking**: Ensure the customer has paid the advance. The status must show payment as "PAID" or have a positive "Advance Paid" value.
- **Check-In Button Disabled**: Check if the booking start date has arrived.
- **Broadcast Not Sending**: Ensure you have active (checked-in) customers for the selected property.
