# Central push relay configuration

The workspace provisioner Worker also delivers encrypted native-device push
tokens. Its runtime needs:

- APNs: `APNS_TEAM_ID`, `APNS_KEY_ID`, and secret `APNS_PRIVATE_KEY`.
- Firebase Cloud Messaging HTTP v1: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and
  secret `FCM_PRIVATE_KEY` from a least-privilege service account allowed to
  send Firebase Cloud Messaging messages.
- Shared encrypted token storage: secret `PUSH_DEVICE_ENCRYPTION_KEY`.

The Android release build separately requires the matching Firebase
`android/app/google-services.json`. It is intentionally ignored by Git and must
be supplied from release secrets. Signed release builds fail closed if it is
absent, rather than publishing an APK with nonfunctional notifications.
