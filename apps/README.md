# 1Helm clients

The iOS, Android, and desktop shells connect to a 1Helm Cloud Worker over HTTPS. They default to 1HC and accept a custom HTTPS host from your own Cloudflare install. The distributed desktop package contains no local server files or AI provider keys.

From this directory, run `npm ci`. `npm run mobile:sync` generates the native app icons and syncs Capacitor projects. Xcode and an Apple signing setup are needed for iOS; Android Studio and Android signing setup are needed for Android. Run `npm run package:cloud:desktop -- linux x64`, `-- win32 x64`, or `-- darwin arm64` to make an unpacked Electron app for review. Packaging does not sign, notarize, publish, or create an installer.

The app IDs match the historical clients so saved target choices remain in their existing native storage. Before distributing a client, verify login, the one-time code return path, uploads and downloads, external links, reconnect, notifications, and native bridge permissions on the target device. Web Push works in the browser; native push relay setup is separate.
