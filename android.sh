#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner. The QA server runs on the host at :8000.
set -x
adb reverse tcp:8000 tcp:8000
adb shell "echo '_ --disable-fre --no-default-browser-check --no-first-run --autoplay-policy=no-user-gesture-required' > /data/local/tmp/chrome-command-line"
adb shell am set-debug-app --persistent com.android.chrome || true
adb shell pm list packages | grep -i chrome || echo "Chrome is not installed on this emulator image"
URL=$(node run-browsers.mjs url android-chrome Emulator)
adb shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main -d "\"$URL\"" \
  || adb shell am start -a android.intent.action.VIEW -d "\"$URL\""
sleep 60; adb exec-out screencap -p > shot-android-1min.png || true
node run-browsers.mjs wait android-chrome || true
adb exec-out screencap -p > shot-android-end.png || true
