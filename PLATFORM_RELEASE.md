# Platform release handoff

## Targets

- Web: Vite production build plus installable PWA shell.
- Android: Capacitor app ID `com.easybrainrot.reader`, minimum SDK 23,
  target SDK 35.
- iOS: Capacitor app name `EasyBrainrot Reader`, bundle identifier
  `com.easybrainrot.reader`.

## Build locally

```bash
npm ci
npm run build
npm run mobile:sync
```

Android requires JDK 21 and the Android SDK. Open Android Studio with
`npm run mobile:android`, or build directly:

```bash
cd android
./gradlew bundleRelease
```

iOS requires macOS, Xcode, and CocoaPods. Open the project with
`npm run mobile:ios`, or compile an unsigned Simulator build:

```bash
cd ios/App
pod install
xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

## Backend connection

Set `VITE_API_BASE_URL` to the HTTPS address of the deployed Node/FFmpeg
backend before `npm run mobile:sync`. If the backend uses `APP_PASSWORD`, the
app prompts for it on the first protected request and reuses it locally.

## CI

`.github/workflows/platform-builds.yml` builds the PWA, Android release AAB,
and unsigned iOS Simulator app on their native runners. Android production
signing uses the optional `ANDROID_KEYSTORE_FILE`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`
environment variables.

## Before store submission

1. Set the production backend URL and verify rendering from a physical device.
2. Configure the final Android upload keystore in protected CI secrets.
3. Configure the Apple team, bundle identifier, signing certificate, and
   provisioning profile in Xcode/App Store Connect.
4. Add store screenshots, privacy details, and content-rating declarations.
