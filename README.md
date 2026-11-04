# FastPix Stream QA

One page that checks a FastPix HLS stream against its settings, tests real browsers and
devices, plays the stream at different network speeds, and produces one PDF report.

## One-time setup (about 5 minutes)

1. Create a GitHub repo (public = unlimited free minutes; private = 2,000 free minutes a
   month, and Mac minutes count 10x).
2. Upload everything in this folder to it, keeping the folders (`.github/workflows`, `ci`).
3. Create a fine-grained token: GitHub > Settings > Developer settings > Fine-grained tokens >
   Generate. Repository access: only this repo. Permissions: **Actions: Read and write**,
   **Contents: Read**.

## Every test

1. On your computer, in this folder: `python3 qa_server.py`, then open http://localhost:8000
2. Enter the playback URL and settings, plus the repo name and token (saved in your browser).
3. Click **Run on all devices**. Wait 10-25 minutes. Results load by themselves.
4. Click **Download PDF report**.

## What runs where

| Job | Browsers |
|---|---|
| Windows | Chrome, Edge, Firefox |
| Mac | Safari, Chrome, Firefox, iPhone simulator (Safari) |
| Linux | Chrome, Firefox |
| Android | Android emulator (Chrome) |

Cloud machines have no graphics card, so Chrome and Edge there report H.265 as not
supported; the iPhone simulator and Android emulator use the host machine's decoder, not a
phone's. The report says so. Physical phones and smart TVs are not covered.
