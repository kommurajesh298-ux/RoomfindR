# Customer App Manual Testing

## Signup flow

- [ ] Enter an invalid email and confirm validation appears
- [ ] Enter a valid email and request OTP
- [ ] Confirm success feedback appears after OTP send
- [ ] Confirm resend stays disabled during the cooldown window
- [ ] Enter an invalid OTP and confirm the correct error appears
- [ ] Enter a valid 6-digit OTP and continue
- [ ] Complete profile details and finish signup

## Login flow

- [ ] Invalid email or password shows an error
- [ ] Valid email/password logs in successfully
- [ ] Protected pages open only after login

## Password reset

- [ ] Forgot password sends reset OTP for a valid email
- [ ] Invalid or expired OTP shows the correct error
- [ ] Valid OTP and new password complete the reset flow

## Session behavior

- [ ] Refresh after login and confirm the session is restored
- [ ] Log out and confirm protected routes redirect correctly

## Core customer flows

- [ ] Home page loads listings
- [ ] Property details page opens correctly
- [ ] Booking flow opens and validates expected states
- [ ] Location selection and current-location resolution behave correctly
