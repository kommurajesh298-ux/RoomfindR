# RoomFindR Manual Testing Guide - Complete 10-Step Protocol

## Overview
This guide provides step-by-step instructions for comprehensive testing of the RoomFindR system, including customer bookings, owner bank verification, settlement payouts, and refund processing.

**System Prerequisites:**
- All three apps running: customer-app (5173), owner-app (5174), admin-panel (5175)
- Supabase project with full database access
- Cashfree test/sandbox credentials configured
- A secondary browser/incognito window for testing multiple users simultaneously

**Time Estimate:** 60-90 minutes for complete testing

---

## STEP 1: Create Test Accounts (Customer, Owner, Admin)

### 1.1: Create Customer Account
1. Open customer-app at `http://localhost:5173`
2. Click "Signup" or navigate to `/signup`
3. Enter test customer details:
   - **Email:** `customer-test@roomfindr.com`
   - **Phone:** `9876543210`
   - **Name:** `Test Customer`
   - **Password:** `TestPass@123`
4. Complete OTP verification (if enabled, use test OTP)
5. Click "Create Account"
6. **Verify in Supabase:**
   ```sql
   SELECT id, email, phone, user_metadata FROM auth.users
   WHERE email = 'customer-test@roomfindr.com';

   SELECT id, user_id, name, email FROM public.users
   WHERE email = 'customer-test@roomfindr.com';
   ```
   ✓ Should see user record in both auth.users and public.users tables

### 1.2: Create Owner Account
1. Open owner-app in new tab at `http://localhost:5174`
2. Click "Signup"
3. Enter test owner details:
   - **Email:** `owner-test@roomfindr.com`
   - **Phone:** `9876543211`
   - **Name:** `Test Owner`
   - **Password:** `TestPass@123`
4. Complete signup process
5. **Expected:** Redirected to owner dashboard or onboarding
6. **Verify in Supabase:**
   ```sql
   SELECT id, email, phone, user_metadata FROM auth.users
   WHERE email = 'owner-test@roomfindr.com';

   SELECT id, user_id, name, email, onboarding_status FROM public.owners
   WHERE email = 'owner-test@roomfindr.com';
   ```
   ✓ Should see owner record with onboarding_status (likely 'bank_verification_pending')

### 1.3: Create Admin Account
1. Open admin-panel at `http://localhost:5175`
2. Login with admin credentials (if seeded) or create via Supabase:
   ```sql
   INSERT INTO auth.users (email, phone, user_metadata)
   VALUES ('admin-test@roomfindr.com', '9876543212',
           '{"name": "Test Admin", "role": "admin"}');

   INSERT INTO public.users (user_id, email, phone, name, role)
   VALUES ((SELECT id FROM auth.users WHERE email = 'admin-test@roomfindr.com'),
           'admin-test@roomfindr.com', '9876543212', 'Test Admin', 'admin');
   ```
3. Verify admin can access admin-panel
4. **Expected:** Full access to Owners, Properties, Bookings, Settlements pages

---

## STEP 2: Owner Bank Verification with ₹1 Cashfree Validation

### 2.1: Access Bank Verification in Owner App
1. Log in as owner (`owner-test@roomfindr.com` / `TestPass@123`)
2. Navigate to Settings or Onboarding section
3. Look for "Bank Account Verification" or "Complete KYC"
4. **Expected UI Elements:**
   - Account Number field
   - IFSC Code field
   - Account Holder Name field
   - Submit button

### 2.2: Enter Bank Details
1. Fill in test bank details:
   - **Account Number:** `9876543210123456` (test format)
   - **IFSC Code:** `SBIN0000001` (test IFSC)
   - **Account Holder Name:** `Test Owner`
2. Click "Submit" or "Verify Bank Account"
3. **Expected:** Cashfree bank verification flow initiates
   - Redirect to Cashfree verification page
   - Or in-app verification modal appears

### 2.3: Process ₹1 Validation Transfer
1. **What Happens:** Cashfree sends ₹1 test transfer to the provided bank account
2. **In Real Scenario:** Owner would see this transfer in their bank account (within 24-48 hours in production)
3. **For Testing:** Check Supabase for verification status update
4. **Database Check:**
   ```sql
   SELECT id, owner_id, account_number, verification_status,
          cashfree_beneficiary_id, created_at, updated_at
   FROM public.owner_bank_accounts
   WHERE owner_id = (SELECT id FROM public.owners WHERE email = 'owner-test@roomfindr.com');
   ```
   ✓ Should see record with:
   - `verification_status = 'pending'` or `'verified'` (depending on Cashfree response)
   - `cashfree_beneficiary_id` populated (Cashfree's internal ID)

### 2.4: Verify Bank Account Status in Admin Panel
1. Log in to admin-panel (`admin-test@roomfindr.com`)
2. Navigate to "Owners" section
3. Find owner record: `Test Owner`
4. Check bank verification status
5. **Expected States:**
   - `PENDING`: Awaiting Cashfree verification (can still create properties)
   - `VERIFIED`: Bank account confirmed by Cashfree (can receive settlements)
6. **Admin Can Force Verification (if needed):**
   - In Supabase: `UPDATE owner_bank_accounts SET verification_status = 'verified' WHERE...`

### 2.5: Verify Owner Approval Status
1. In Admin Panel → Owners → Find Test Owner
2. Check if approval status shows:
   - ✓ Bank Verification: In Progress or Completed
   - Click "Approve Owner" button if visible
3. **Database Check:**
   ```sql
   SELECT id, name, approval_status, bank_verification_status, created_at
   FROM public.owners
   WHERE email = 'owner-test@roomfindr.com';
   ```
   ✓ Should see `approval_status = 'approved'` or `'pending'` based on admin action

---

## STEP 3: Owner Creates PG Listing with All Required Fields

### 3.1: Navigate to Create Property
1. Log in to owner-app as `owner-test@roomfindr.com`
2. Click "Add Property" or navigate to `/properties/create`
3. **Expected:** Multi-step form appears

### 3.2: Fill Property Details (Step 1)
1. **Property Type:** Select "PG" or "Hostel"
2. **Property Name:** `Test PG Delhi`
3. **Address:** `123 Samrat Apartments, Sector 12, New Delhi`
4. **Location:** Set on map or dropdown
5. **City/Pincode:** Delhi / 110001
6. **Description:** `A comfortable PG with all amenities`
7. Click "Continue" or "Next"

### 3.3: Fill Amenities & Features (Step 2)
1. Select amenities:
   - ✓ WiFi
   - ✓ Parking
   - ✓ Meals
   - ✓ Air Conditioning
   - ✓ Laundry
2. Fill:
   - **Check-in Time:** 2:00 PM
   - **Check-out Time:** 11:00 AM
   - **Rules:** No visitors after 10 PM, Quiet hours 10 PM - 8 AM
3. Click "Continue"

### 3.4: Fill Rooms/Beds Configuration (Step 3)
1. Click "Add Room"
2. For each room, fill:
   - **Room Type:** Single / Shared (e.g., "Single Room")
   - **Capacity:** 1 or 2
   - **Price:** ₹12,000 / month
   - **Vacancies:** 1-2
   - **Furnishing:** Semi-Furnished
   - **Attached Bathroom:** Yes/No
   - **Upload Images:** Add 2-3 test room images
3. Click "Add Room" again to add second room type if desired
4. **Example Setup:**
   - Room 1: Single Room, ₹12,000/month, 2 vacancies
   - Room 2: Shared (2-bed), ₹7,000/month, 3 vacancies
5. Click "Continue"

### 3.5: Upload Property Images (Step 4)
1. Click "Upload Images" or drag-drop
2. Add at least 3-4 images:
   - Property exterior
   - Living area/common room
   - Room interior
   - Amenities/Kitchen
3. **Expected:** Images preview shown
4. Click "Continue"

### 3.6: Review & Submit
1. Review all details
2. Check "I agree to terms and conditions"
3. Click "Submit" or "Publish Property"
4. **Expected:**
   - Loading spinner appears
   - Success message shown
   - Redirected to property details or properties list

### 3.7: Verify Property in Supabase
1. **Check properties table:**
   ```sql
   SELECT id, title, owner_id, status, price_per_month, vacancies, created_at
   FROM public.properties
   WHERE owner_id = (SELECT id FROM public.owners WHERE email = 'owner-test@roomfindr.com')
   ORDER BY created_at DESC LIMIT 1;
   ```
   ✓ Should see newly created property with `status = 'active'` or `'pending_approval'`

2. **Check rooms table:**
   ```sql
   SELECT id, property_id, room_type, capacity, price_per_month, vacancies
   FROM public.rooms
   WHERE property_id = (SELECT id FROM public.properties
                        WHERE title LIKE '%Test PG%' LIMIT 1)
   ORDER BY created_at;
   ```
   ✓ Should see 1-2 room records

3. **Check property images:**
   ```sql
   SELECT id, property_id, image_url, display_order
   FROM public.property_images
   WHERE property_id = (SELECT id FROM public.properties
                        WHERE title LIKE '%Test PG%' LIMIT 1)
   ORDER BY display_order;
   ```
   ✓ Should see 3+ image records with URLs

### 3.8: Verify Property Visibility in Customer App
1. Switch to customer-app tab
2. Search for property: Search for "Delhi" or your city
3. Find "Test PG Delhi" in listing
4. Click on property to view details
5. **Expected:**
   - Property details page loads
   - All images visible in carousel
   - Room types with prices displayed
   - "Book Room" button visible
   - ✓ All information accurate

---

## STEP 4: Customer Booking Flow with Cashfree Payment

### 4.1: Initiate Booking
1. In customer-app, viewing Test PG property details
2. Select room type: "Single Room" (₹12,000/month)
3. Click "Book Room" or "Book Now"
4. **Expected:** Booking modal or new page appears

### 4.2: Fill Booking Details
1. **Check-in Date:** Select date 1 week from now
2. **Duration:** "1 Month" or select "3 Months"
3. **Purpose:** Select from dropdown (e.g., "Job", "Studies")
4. **Occupant Details:**
   - Name: `Test Customer`
   - Phone: `9876543210` (prefilled)
5. Review:
   - **Subtotal:** ₹12,000 (for 1 month)
   - **Platform Fee:** ₹600 (5% example)
   - **GST:** ₹72 (5% of fee)
   - **Total:** ₹12,672
6. Click "Proceed to Payment" or "Continue"

### 4.3: Enter Payment Details
1. **Payment Method Selection Page:**
   - Select "Credit Card", "Debit Card", or "UPI"
   - Example: Select "UPI"
2. **Expected:** Cashfree payment gateway loads
3. Enter test payment details:
   - **UPI ID:** `success@ybl` (test success UPI)
   - **OTP:** Enter 123456 (test OTP)
   - Or use Cashfree test card: `4111111111111111` (Visa)

### 4.4: Verify Payment Processing
1. **UI Expected:**
   - Payment processing spinner
   - Some apps show: "Verifying payment..."
2. **Wait:** 3-5 seconds for Cashfree processing
3. **Expected Result:**
   - ✓ "Payment Successful" message OR
   - ✓ Redirected to booking confirmation page
4. **Booking Confirmation Shows:**
   - Booking ID: `BK_XXXXX`
   - Reference Number
   - Property details
   - Payment receipt
   - Move-in date

### 4.5: Verify Payment in Supabase
1. **Check bookings table:**
   ```sql
   SELECT id, customer_id, property_id, room_id, booking_status,
          check_in_date, duration_months, total_amount, created_at
   FROM public.bookings
   WHERE customer_id = (SELECT id FROM public.users WHERE email = 'customer-test@roomfindr.com')
   ORDER BY created_at DESC LIMIT 1;
   ```
   ✓ Should see new booking with:
   - `booking_status = 'confirmed'` or `'payment_pending'`
   - `total_amount = 12672`
   - `check_in_date` = future date

2. **Check payments table:**
   ```sql
   SELECT id, booking_id, payment_type, amount, status,
          cashfree_order_id, cashfree_payment_id, created_at
   FROM public.payments
   WHERE booking_id = (SELECT id FROM public.bookings
                       WHERE customer_id = (SELECT id FROM public.users
                                           WHERE email = 'customer-test@roomfindr.com')
                       ORDER BY created_at DESC LIMIT 1)
   ORDER BY created_at DESC;
   ```
   ✓ Should see payment record with:
   - `payment_type = 'initial'` or `'booking'`
   - `status = 'success'` or `'completed'`
   - `cashfree_order_id` populated (Cashfree order ID)
   - `cashfree_payment_id` populated (Cashfree payment ID)

### 4.6: Verify Notification & Realtime Sync
1. **Check if owner receives notification:**
   - Log in to owner-app (different browser/incognito)
   - Navigate to "Bookings" or "Properties"
   - Should see notification: "New booking for Test PG Delhi"
   - Booking should appear in owner's booking list

2. **Check notifications table:**
   ```sql
   SELECT id, user_id, type, title, message, read_at, created_at
   FROM public.notifications
   WHERE user_id = (SELECT id FROM public.owners WHERE email = 'owner-test@roomfindr.com')
   ORDER BY created_at DESC LIMIT 1;
   ```
   ✓ Should see notification with `type = 'new_booking'`

### 4.7: Verify Cashfree Transaction Log
*If you have Cashfree dashboard access:*
1. Log in to Cashfree dashboard
2. Navigate to: Transactions → Orders
3. Search for order ID from payments table above
4. ✓ Should see transaction with:
   - Status: SUCCESS
   - Amount: ₹12,672
   - Payment Method: UPI (or selected method)
   - Settlement: Pending → Settled (after 2-3 days in production)

---

## STEP 5: Admin Settlement Payout to Owner (Booking Payment)

### 5.1: Owner Approves Booking (Owner App)
1. Log in to owner-app as `owner-test@roomfindr.com`
2. Go to "Bookings"
3. Find the new booking from Step 4: "Test Customer - Single Room"
4. Click on booking to view details
5. **Review Booking Details:**
   - Customer: Test Customer
   - Room: Single Room
   - Check-in: [future date]
   - Payment: ✓ Verified (green checkmark)
   - Status: "Awaiting Approval"
6. Click "Approve Booking" button
7. **Expected:** Modal asks for confirmation
8. Click "Confirm" or "Yes, Approve"
9. **Expected Result:**
   - ✓ Status changes to "Confirmed"
   - Notification sent to customer
   - Settlement record created

### 5.2: Verify Settlement Created in Supabase
```sql
SELECT id, owner_id, amount, net_payable, platform_fee, gst_amount,
       settlement_status, payment_method, created_at
FROM public.settlements
WHERE owner_id = (SELECT id FROM public.owners WHERE email = 'owner-test@roomfindr.com')
ORDER BY created_at DESC LIMIT 1;
```
✓ Should see settlement record with:
- `settlement_status = 'created'` or `'pending'`
- `amount` = ₹12,000 (property cost)
- `platform_fee` = ₹600
- `gst_amount` = ₹72
- `net_payable` = ₹11,328 (amount - platform_fee)

### 5.3: Create Settlement in Admin Panel
1. Log in to admin-panel as `admin-test@roomfindr.com`
2. Navigate to "Settlements"
3. **View Pending Settlements:**
   - Filter: Status = "Pending" or "Created"
   - Should see settlement for Test Owner with ₹11,328
4. Click on settlement to view details
5. **Verify Details:**
   - Owner: Test Owner
   - Amount: ₹12,000
   - Platform Fee: ₹600
   - Net Payable: ₹11,328
   - Associated Booking: [booking ID from Step 4]

### 5.4: Process Settlement Payout
1. Click "Process Settlement" or "Approve for Payout"
2. **Review Dialog Shows:**
   - Payee: Test Owner
   - Account: XXXX3456 (last 4 of bank account)
   - Amount: ₹11,328
   - Fee Details breakdown
3. Click "Confirm & Transfer" or "Process Payout"
4. **Expected:**
   - Loading spinner
   - ✓ "Settlement processed successfully"
   - Status changes to "PROCESSING"

### 5.5: Verify Settlement Status Update
```sql
SELECT id, owner_id, settlement_status, payout_status,
       cashfree_payout_id, processed_at, updated_at
FROM public.settlements
WHERE owner_id = (SELECT id FROM public.owners WHERE email = 'owner-test@roomfindr.com')
ORDER BY created_at DESC LIMIT 1;
```
✓ Should see:
- `settlement_status = 'processing'` or `'completed'`
- `payout_status = 'initiated'` or `'success'` or `'pending'`
- `cashfree_payout_id` populated (Cashfree payout reference)

### 5.6: Verify Owner Receives Payout Notification
1. Log in to owner-app
2. Check "Notifications" or "Settlements"
3. Should see: "Settlement of ₹11,328 processed for [property name]"
4. Navigate to "Payouts" or "Payment History"
5. ✓ Should see payout record with status "Processing" or "Completed"

### 5.7: Verify Cashfree Payout Log
*If Cashfree dashboard available:*
1. Log in to Cashfree
2. Navigate to: Payouts
3. Search for payout ID from settlements table
4. ✓ Should see:
   - Status: INITIATED → In Transit → SUCCESS (within 24 hours in production)
   - Beneficiary: Test Owner's account details
   - Amount: ₹11,328

---

## STEP 6: Customer Monthly Rent Payment

### 6.1: Trigger Monthly Rent Payment in Customer App
1. Log in to customer-app as `customer-test@roomfindr.com`
2. Navigate to "Bookings"
3. Find booking from Step 4: "Test PG Delhi - Single Room"
4. View booking details
5. **Expected Elements:**
   - Current status: "Confirmed" or "Active"
   - Next payment due: [calculated date]
   - Payment history section
   - "Pay Now" button for next month

### 6.2: Initiate Rent Payment
1. Click "Pay Rent" or "Pay Monthly Charge"
2. **Payment Details Modal Shows:**
   - Month: [current or next month]
   - Amount: ₹12,000 (monthly rent)
   - Rent breakdown (if applicable)
   - Total Due: ₹12,000
3. Click "Proceed to Payment"
4. **Expected:** Cashfree payment gateway opens with prefilled amount

### 6.3: Complete Rent Payment
1. Select payment method: UPI / Card
2. Enter test credentials:
   - UPI: `success@ybl`
   - Or Card: `4111111111111111`
3. Enter OTP: `123456`
4. **Expected:** ✓ "Payment Successful"
5. **Confirmation Shows:**
   - Payment ID
   - Receipt available for download
   - "Next payment due on [date]"

### 6.4: Verify Rent Payment in Supabase
```sql
SELECT id, booking_id, payment_type, amount, status,
       cashfree_order_id, month, created_at
FROM public.payments
WHERE booking_id = (SELECT id FROM public.bookings
                   WHERE customer_id = (SELECT id FROM public.users
                                       WHERE email = 'customer-test@roomfindr.com'))
ORDER BY created_at DESC;
```
✓ Should see TWO payment records:
1. First: `payment_type = 'initial'`, `status = 'success'` (from Step 4)
2. Second: `payment_type = 'monthly'` or `'rent'`, `status = 'success'` (current)

### 6.5: Verify Booking Status Updates
```sql
SELECT id, booking_id, payment_month, payment_status, amount, created_at
FROM public.booking_payments
WHERE booking_id = (SELECT id FROM public.bookings
                   WHERE customer_id = (SELECT id FROM public.users
                                       WHERE email = 'customer-test@roomfindr.com'));
```
✓ Should show track of all monthly payments

---

## STEP 7: Admin Rent Settlement to Owner

### 7.1: View Pending Rent Settlements (Admin)
1. Log in to admin-panel
2. Navigate to "Settlements"
3. **Filter Options:**
   - Status: "Pending"
   - Type: "Monthly Rent" (if available)
4. **Should See:**
   - New settlement for Test Owner
   - Amount: ₹12,000 (from Step 6 rent payment)
   - Type: "Monthly Rent Settlement"

### 7.2: Review Settlement Details
1. Click on settlement for Test Owner
2. **Details Show:**
   - Customer: Test Customer
   - Property: Test PG Delhi
   - Room: Single Room
   - Payment Type: Monthly Rent
   - Amount: ₹12,000
   - Platform Fee: ₹600 (5%)
   - Net Payable: ₹11,328 (amount - 5% fee)
   - Status: PENDING

### 7.3: Process Rent Settlement
1. Click "Approve & Process" or "Create Payout"
2. Confirm dialog shows payout details
3. Click "Confirm Transfer"
4. **Expected:**
   - ✓ "Payout initiated successfully"
   - Status changes to "PROCESSING"

### 7.4: Verify Monthly Settlement in Supabase
```sql
SELECT id, owner_id, settlement_type, amount, net_payable,
       settlement_status, payout_status, cashfree_payout_id,
       created_at, processed_at
FROM public.settlements
WHERE owner_id = (SELECT id FROM public.owners WHERE email = 'owner-test@roomfindr.com')
ORDER BY created_at DESC
LIMIT 2;
```
✓ Should see TWO settlements:
1. First: From Step 5 (booking deposit) - Status: COMPLETED (or similar)
2. Second: From Step 7 (monthly rent) - Status: PROCESSING
- `settlement_type = 'monthly_rent'` or `'rent_payment'`
- `cashfree_payout_id` populated

### 7.5: Verify Owner Notification
1. Log in to owner-app
2. Check "Notifications"
3. Should see: "Monthly rent settlement of ₹11,328 processed"
4. Navigate to "Payouts" or "Settlement History"
5. ✓ Should show both settlements (booking + monthly rent)

---

## STEP 8: Booking Rejection Scenario

### 8.1: Create New Booking to Reject
1. Create another booking in customer-app (use different customer or same)
2. Go through the full booking flow (Steps 4.1 - 4.6)
3. **Booking Details:**
   - Property: Test PG Delhi
   - Room: Shared (2-bed)
   - Amount: ₹7,000
   - Status: "Awaiting Approval"

### 8.2: Owner Rejects Booking
1. Log in to owner-app as Test Owner
2. Go to "Bookings"
3. Find the new booking to reject
4. Click on booking details
5. **Look for "Reject" or "Decline" button**
6. Click "Reject Booking"
7. **Modal Dialog Shows:**
   - Reason for rejection (dropdown):
     - Select "Room already booked"
     - Or "Wrong details"
   - Optional message field
8. Click "Confirm Rejection"
9. **Expected:**
   - ✓ "Booking rejected"
   - Status changes to "REJECTED"
   - Notification sent to customer

### 8.3: Verify Rejection in Supabase
```sql
SELECT id, customer_id, property_id, booking_status,
       rejection_reason, rejection_date, created_at
FROM public.bookings
WHERE status = 'rejected'
AND property_id = (SELECT id FROM public.properties WHERE title LIKE '%Test PG%')
ORDER BY created_at DESC LIMIT 1;
```
✓ Should see booking with:
- `booking_status = 'rejected'` or `'declined'`
- `rejection_reason` populated
- `rejection_date` set

### 8.4: Verify Customer Notification
1. Log in to customer-app with the customer who made the rejected booking
2. Check "Notifications"
3. ✓ Should see: "Your booking for [property] has been rejected"
4. In "Bookings" section, booking should show:
   - Status: "REJECTED"
   - Reason displayed
   - "Request Refund" or "View Refund Status" button

### 8.5: Check Room Vacancy Restored
```sql
SELECT id, room_id, property_id, vacancies
FROM public.rooms
WHERE property_id = (SELECT id FROM public.properties WHERE title LIKE '%Test PG%');
```
✓ Should see room vacancies increased (refund/cancellation processing)

---

## STEP 9: Admin Refund to Customer for Rejected Booking

### 9.1: View Refund Request (Admin)
1. Log in to admin-panel
2. Navigate to "Refunds" section
3. **Should See:**
   - Status filter: "Pending" or "Requested"
   - Refund for Test Customer's rejected booking
   - Amount: ₹7,000 (or full amount including fee)

### 9.2: Review Refund Details
1. Click on refund record
2. **Details Show:**
   - Customer: Test Customer
   - Booking: [booking ID]
   - Property: Test PG Delhi
   - Original Amount: ₹7,000
   - Refund Amount: ₹7,000 (full refund for reject)
   - Status: PENDING
   - Reason: "Booking rejected by owner"

### 9.3: Approve & Process Refund
1. Click "Approve Refund" or "Process Refund"
2. **Confirmation Dialog Shows:**
   - Refund amount: ₹7,000
   - Reverting to: Test Customer's Cashfree wallet/account
3. Click "Confirm & Issue Refund"
4. **Expected:**
   - ✓ "Refund processed successfully"
   - Status changes to "PROCESSING"

### 9.4: Verify Refund in Supabase
```sql
SELECT id, booking_id, customer_id, refund_amount, refund_status,
       refund_reason, cashfree_refund_id, created_at, processed_at
FROM public.refunds
WHERE booking_id = (SELECT id FROM public.bookings
                   WHERE booking_status = 'rejected'
                   ORDER BY created_at DESC LIMIT 1);
```
✓ Should see refund record with:
- `refund_status = 'processing'` or `'completed'`
- `refund_amount = 7000`
- `refund_reason = 'booking_rejected'`
- `cashfree_refund_id` populated (Cashfree refund ID)

### 9.5: Verify Customer Receives Refund Notification
1. Log in to customer-app
2. Check "Notifications"
3. ✓ Should see: "Refund of ₹7,000 processed for [booking]"
4. In "Bookings" section:
   - Booking status: "REJECTED"
   - Refund status: "Processing" → "Completed"
   - Message: "Refund issued to your original payment method"

### 9.6: Verify Cashfree Refund Log
*If Cashfree dashboard available:*
1. Log in to Cashfree
2. Navigate to: Refunds
3. Search for refund ID from refunds table
4. ✓ Should see:
   - Status: INITIATED → SUCCESS
   - Original Order: [cashfree_order_id from initial payment]
   - Refund Amount: ₹7,000
   - Timeline: Usually 3-5 business days to customer's account

---

## STEP 10: Payment Cancellation and Interrupt Handling

### 10.1: Initiate Payment But Cancel During Flow
1. Log in to customer-app
2. Navigate to a property (Test PG Delhi or another)
3. Click "Book Room"
4. Fill all booking details:
   - Check-in date
   - Duration
   - Payment amount: ~₹12,000
5. Click "Proceed to Payment"
6. **In Cashfree Payment Page:**
   - Do NOT complete the payment
   - Click browser back button OR
   - Close the payment window OR
   - Click "Cancel" button if visible
7. **Expected UI Response:**
   - Return to booking confirmation page
   - Message: "Payment cancelled" or "Payment incomplete"
   - "Retry Payment" button visible

### 10.2: Verify Cancelled Payment in Supabase
```sql
SELECT id, booking_id, status, payment_type,
       cashfree_order_id, created_at, updated_at
FROM public.payments
WHERE status = 'cancelled' OR status = 'failed'
ORDER BY created_at DESC LIMIT 1;
```
✓ Should see payment with:
- `status = 'cancelled'` or `'failed'` or `'abandoned'`
- `cashfree_order_id` present (Cashfree tracking)

### 10.3: Verify Booking Status for Cancelled Payment
```sql
SELECT id, customer_id, booking_status, payment_status, created_at
FROM public.bookings
WHERE id = (SELECT booking_id FROM public.payments
           WHERE status = 'cancelled' OR status = 'failed'
           ORDER BY created_at DESC LIMIT 1);
```
✓ Should see booking with:
- `booking_status = 'payment_failed'` or `'payment_pending'`
- `payment_status = 'failed'` or `'incomplete'`
- Room vacancies should NOT be decremented (still available)

### 10.4: Network Interruption Scenario
1. **Simulate Network Interrupt:**
   - Open DevTools (F12)
   - Go to Network tab
   - Throttle to "Offline"
   - Proceed with booking payment attempt
   - Select payment method
   - Network goes offline during submission

2. **Expected App Behavior:**
   - ✓ Error message: "Network error" or "Connection lost"
   - "Retry" button appears
   - Form data retained (no data loss)

3. **Verify in Supabase:**
   ```sql
   SELECT id, booking_id, status, error_message, created_at
   FROM public.payments
   WHERE error_message LIKE '%network%' OR error_message LIKE '%timeout%'
   ORDER BY created_at DESC LIMIT 1;
   ```

### 10.5: Duplicate Payment Prevention
1. **Simulate Rapid Click:**
   - On payment confirmation screen
   - Click "Confirm Payment" button rapidly 2-3 times

2. **Expected Behavior:**
   - ✓ Button disabled after first click (disabled state)
   - OR duplicate not created (idempotency guarantee)
   - Only ONE payment record created

3. **Verify in Supabase:**
   ```sql
   SELECT booking_id, COUNT(*) as payment_count
   FROM public.payments
   WHERE booking_id = [test_booking_id]
   GROUP BY booking_id;
   ```
   ✓ Should show only 1 or 2 payments max, not 3+

### 10.6: Retry After Interruption
1. Go back to booking that has cancelled payment
2. Click "Retry Payment" or re-initiate booking
3. Complete payment successfully this time
4. **Expected:**
   - ✓ Payment succeeds
   - New payment record created (old cancelled one remains)
   - Booking status updates to "Confirmed"
   - Settlement flow can proceed

### 10.7: Verify Retry in Supabase
```sql
SELECT id, booking_id, status, attempt_number,
       cashfree_order_id, created_at
FROM public.payments
WHERE booking_id = [retry_booking_id]
ORDER BY created_at;
```
✓ Should see:
- First record: `status = 'cancelled'` or `'failed'`
- Second record: `status = 'success'`
- Different `cashfree_order_id` for each attempt

---

## Summary Verification Checklist

After completing all 10 steps, verify the following in Supabase:

### Database Integrity Check
```sql
-- 1. Customer created and has active bookings
SELECT COUNT(*) as customer_bookings FROM public.bookings
WHERE customer_id = (SELECT id FROM public.users WHERE email = 'customer-test@roomfindr.com');

-- 2. Owner created, verified, and has property
SELECT COUNT(*) as owner_properties FROM public.properties
WHERE owner_id = (SELECT id FROM public.owners WHERE email = 'owner-test@roomfindr.com');

-- 3. All payments recorded
SELECT COUNT(*) as total_payments FROM public.payments;

-- 4. Settlements created and processed
SELECT COUNT(*) as total_settlements FROM public.settlements;

-- 5. Refunds issued
SELECT COUNT(*) as refunds_issued FROM public.refunds
WHERE refund_status IN ('success', 'completed', 'processing');

-- 6. Notifications sent
SELECT COUNT(*) as notifications_sent FROM public.notifications;
```

### Expected Results
- **Customer bookings:** 2-3 (at least one confirmed, one rejected)
- **Owner properties:** At least 1
- **Total payments:** 3+ (initial booking + monthly rent + others)
- **Settlements:** 2+ (booking settlement + rent settlement)
- **Refunds issued:** At least 1
- **Notifications:** 10+ (booking notifications, payment confirmations, etc.)

---

## Troubleshooting Common Issues

### Issue 1: Payment Failed at Cashfree
**Symptoms:** "Payment failed" error after submitting payment
**Solutions:**
1. Check Cashfree credentials in .env files
2. Verify in Supabase: `payments` table shows `status = 'failed'`
3. Check `error_message` field for specific Cashfree error code
4. **Fix:** Update `.env` with correct Cashfree test keys
5. Retry payment attempt

### Issue 2: Bank Verification Stuck in Pending
**Symptoms:** Owner bank verification shows "Pending" for hours
**Solutions:**
1. Check `owner_bank_accounts` table: `verification_status`
2. Verify `cashfree_beneficiary_id` is populated
3. **Manual Fix (for testing):**
   ```sql
   UPDATE owner_bank_accounts
   SET verification_status = 'verified',
       updated_at = NOW()
   WHERE owner_id = [owner_id];
   ```
4. Manually approve in admin panel

### Issue 3: Settlement Not Created After Booking Approval
**Symptoms:** Owner approves booking, but no settlement appears
**Solutions:**
1. Verify booking status: `SELECT * FROM bookings WHERE id = [booking_id];`
2. Check if `booking_status = 'confirmed'`
3. Look for settlement: `SELECT * FROM settlements WHERE...`
4. **Check Logs:** Look for any error in payment verification
5. Manually create settlement:
   ```sql
   INSERT INTO public.settlements
   (owner_id, booking_id, amount, net_payable, platform_fee, gst_amount, settlement_status)
   VALUES ([owner_id], [booking_id], 12000, 11328, 600, 72, 'pending');
   ```

### Issue 4: Refund Not Appearing in Customer Wallet
**Symptoms:** Refund shows "Processing" but funds don't appear
**Solutions:**
1. **Note:** In production, refunds take 3-5 business days
2. For testing, check Supabase: `SELECT * FROM refunds WHERE booking_id = [booking_id];`
3. Verify `cashfree_refund_id` is populated
4. Check Cashfree dashboard for refund status
5. **Cashfree Sandbox Note:** Test refunds may not actually reverse to test accounts

### Issue 5: Realtime Notifications Not Showing
**Symptoms:** Owner doesn't see booking notification in real-time
**Solutions:**
1. Verify Supabase realtime is enabled
2. Check browser console for connection errors
3. Manually refresh the page - notification should appear
4. Check `notifications` table: `SELECT * FROM notifications ORDER BY created_at DESC;`
5. Verify `chat.service.ts` subscription is active

### Issue 6: Multiple Payments Created for Single Booking
**Symptoms:** Same booking has 3+ payment records
**Solutions:**
1. **Check for duplicates:**
   ```sql
   SELECT booking_id, COUNT(*) FROM payments GROUP BY booking_id HAVING COUNT(*) > 1;
   ```
2. Mark duplicate payments as cancelled:
   ```sql
   UPDATE payments SET status = 'cancelled' WHERE id = [duplicate_payment_id];
   ```
3. Ensure payment form button is properly disabled after submission

---

## Cashfree Test Credentials & Sandbox Guide

### Test UPI IDs (Always Succeed)
- `success@ybl` - Payment succeeds
- `failure@ybl` - Payment fails
- `otp@ybl` - Shows OTP entry

### Test Cards
**Success Cards:**
- Visa: `4111111111111111` (Amount: any)
- MasterCard: `5555555555554444` (Amount: any)

**Failure Cards:**
- Visa: `4000000000000002` (Fails)
- MasterCard: `5555555555554477` (Fails)

### Test OTP
- Any 6-digit number (e.g., `123456`)
- Or use `0` for skip (depends on Cashfree config)

### Cashfree Order IDs vs Payment IDs
- **Order ID:** Unique per checkout session (`order_[timestamp]`)
- **Payment ID:** Assigned after successful payment (`pay_[cashfree_id]`)
- Both stored in `payments.cashfree_order_id` and `payments.cashfree_payment_id`

---

## Test Data Summary

| Entity | Email | Phone | Password | Status |
|--------|-------|-------|----------|--------|
| Customer | customer-test@roomfindr.com | 9876543210 | TestPass@123 | Active |
| Owner | owner-test@roomfindr.com | 9876543211 | TestPass@123 | Bank Verified |
| Admin | admin-test@roomfindr.com | 9876543212 | TestPass@123 | Active |

| Property | Type | Rooms | Price | Vacancies |
|----------|------|-------|-------|-----------|
| Test PG Delhi | PG | Single (2), Shared (3) | 12k/7k | 2-3 |

| Transaction | Amount | Status | Method |
|-------------|--------|--------|--------|
| Booking Payment | ₹12,672 | Success | UPI |
| Booking Settlement | ₹11,328 | Processing | Cashfree |
| Monthly Rent | ₹12,000 | Success | UPI |
| Rent Settlement | ₹11,328 | Processing | Cashfree |
| Refund | ₹7,000 | Processing | Cashfree |

---

## Next Steps After Testing

1. **Document Issues:** Note any bugs with exact steps to reproduce
2. **Verify Cashfree Integration:** Check all payout IDs in Cashfree dashboard
3. **Test Realtime:** Open multiple browser windows and verify real-time updates
4. **Load Testing:** Create 5-10 bookings and verify system handles concurrent operations
5. **Mobile Testing:** Run through all steps on mobile devices
6. **Production Checklist:** If all tests pass, prepare for production deployment

---

**Testing Duration:** 60-90 minutes
**Data Cleanup:** After testing, optionally delete test records from Supabase
**Contact:** For Cashfree issues, check Cashfree support docs: https://docs.cashfree.com
