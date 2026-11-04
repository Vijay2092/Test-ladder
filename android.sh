#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner. The QA server runs on the host at :8000.
set -x
adb reverse tcp:8000 tcp:8000
# Skip Chrome's first-run screens
adb shell "echo '_ --disable-fre --no-default-browser-check --no-first-run --autoplay-policy=no-user-gesture-required' > /data/local/tmp/chrome-command-line"
adb shell am set-debug-app --persistent com.android.chrome || true
URL=$(node run-browsers.mjs url android-chrome Emulator)
adb shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main -d "\"$URL\"" \
  || adb shell am start -a android.intent.action.VIEW -d "\"$URL\""
node run-browsers.mjs wait android-chrome || true
cp qa_state.json results-android.json || true
