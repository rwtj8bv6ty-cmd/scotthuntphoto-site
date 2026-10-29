#!/bin/bash
# Builds "Scott Hunt Site Manager.app" and a .dmg on a Mac (Xcode command line tools needed).
# Output: mac-app/build/Scott-Hunt-Site-Manager.dmg
set -euo pipefail
cd "$(dirname "$0")"
NAME="Scott Hunt Site Manager"
APP="build/$NAME.app"
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/icon.iconset build/dmg

for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos11.0" -o "build/SiteManager-$arch" Sources/main.swift -framework Cocoa -framework WebKit
done
lipo -create -output "$APP/Contents/MacOS/SiteManager" build/SiteManager-arm64 build/SiteManager-x86_64

sed "s/BUILD_NUMBER/${BUILD_NUMBER:-1}/" Info.plist > "$APP/Contents/Info.plist"
cp -R web "$APP/Contents/Resources/web"

for s in 16 32 128 256 512; do
  sips -z $s $s icon-1024.png --out "build/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) icon-1024.png --out "build/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns build/icon.iconset -o "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc signature: enough for macOS to run it once the user allows it (see README).
codesign --force --deep --sign - "$APP"

cp -R "$APP" build/dmg/
ln -s /Applications build/dmg/Applications
hdiutil create -volname "$NAME" -srcfolder build/dmg -ov -format UDZO build/Scott-Hunt-Site-Manager.dmg
echo "Built mac-app/build/Scott-Hunt-Site-Manager.dmg"
