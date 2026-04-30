# Google Play Store Readiness

## Purpose

Use this file as a release checklist for Android submissions. Do not store real keystore passwords, signing secrets, or console credentials here.

## Customer app

- App name: `RoomFindR`
- Package ID: `com.roomfindr.app`
- Release bundle path: `customer-app/android/app/build/outputs/bundle/release/app-release.aab`
- Keystore path: `customer-app/android/app/roomfindr-release.keystore`
- Keystore alias: keep in secure release notes or secret storage, not this document

## Owner app

- App name: `RoomFindR Owner`
- Package ID: `com.roomfindr.owner`
- Release bundle path: `owner-app/android/app/build/outputs/bundle/release/app-release.aab`
- Keystore path: `owner-app/android/app/roomfindr-owner-release.keystore`
- Keystore alias: keep in secure release notes or secret storage, not this document

## Required store assets

- [ ] 512x512 app icon
- [ ] 1024x500 feature graphic
- [ ] phone screenshots
- [ ] privacy policy URL
- [ ] store descriptions

## Release checks

- [ ] release AAB builds successfully
- [ ] package IDs are correct
- [ ] privacy policy and terms routes work
- [ ] permissions are reviewed
- [ ] data safety answers are prepared
- [ ] Android target SDK requirements are satisfied

## Security rule

Do not commit real signing passwords, Play Console credentials, or private release notes into `docs/`.
