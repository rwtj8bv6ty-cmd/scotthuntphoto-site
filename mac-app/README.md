# Scott Hunt Site Manager (Mac app)

A Mac app for editing everything on the website, on both sides: Scott Hunt Photography and Rock'n H.

## Install
1. Download **Scott-Hunt-Site-Manager.dmg** from
   https://github.com/rwtj8bv6ty-cmd/scotthuntphoto-site/releases/download/mac-app/Scott-Hunt-Site-Manager.dmg
2. Open it and drag **Scott Hunt Site Manager** into **Applications**.
3. The first time only: the app isn't from the App Store, so macOS asks before opening it. Right-click (or
   Control-click) the app in Applications and choose **Open**, then **Open** again. On macOS 15 or later, if
   there is no Open button: try to open it once, then go to **System Settings → Privacy & Security**, scroll
   down and click **Open Anyway**.
4. The app asks for a GitHub access key once. It walks you through making one.

## What it does
- **Galleries:** add photos (drag them in from Finder, or click *Add photos*), remove them, drag them into
  a new order, and move or copy them to another gallery (select them and drag onto a gallery in the sidebar;
  hold Option to copy). Replace a photo while keeping its place. Create, rename, reorder (drag in the sidebar), draft
  or delete galleries, and edit each gallery's Introduction.
- **Sub-galleries:** put a gallery under a main one (*Place in the menu*), reorder them on the main gallery's page or
  in the sidebar, and turn folders from Finder into sub-galleries with their photos.
- **Pages** on either side, including About me: text with simple formatting, side photo, contact form on/off.
- **Rock'n H:** print collections, each with a price list of materials, sizes, prices and edition sizes that every
  print uses unless it has its own; featured prints; **Prints sold**, a page listing every print with how many of
  each size have sold against its edition (with + and − buttons, and room for sizes sold before the website), also
  shown in each print's details; the print-page sections
  (About the Prints, Limited Editions, Dimensions and Borders, Shipping and Production Times); PayPal checkout
  settings; shipping regions (by state) and a shipping price for each size and region, with a button that adds a
  row for every size in the price lists and a warning for any size or region still missing a price; materials
  shipped on request; the Rock'n H home page, artist statement and biography.
- **Home page** photos, site settings and drafts.
- Nothing changes on the website until you press **Publish**. Undo steps back; Discard throws away
  everything not yet published. The website updates about a minute after publishing.

Photos are resized to 2500 pixels on the long side before uploading (HEIC from an iPhone is converted to JPEG).
A photo file is deleted from the website only when nothing uses it any more.

## How it works (for developers)
- `web/` is the editor (plain HTML/JS, no dependencies). It reads the site's `.pages.yml` to know every content
  type and field, so new content types added to the site appear here without changing the app. Collections whose
  label starts with "Rock'n H" go under the Rock'n H side; pages are split by their `side` field; in
  `content/site.json`, fields starting with `rock` belong to Rock'n H (split into Home page & artist, Print pages
  and Checkout). Plain values found in the content files but missing from `.pages.yml` (such as a page's
  `menuTitle`) are offered as fields too.
- `Sources/main.swift` is the native window (WebKit). It stores the access key in
  `~/Library/Application Support/Scott Hunt Site Manager/config.json` (readable only by the user), makes the
  GitHub requests, and caches photos in `~/Library/Caches/Scott Hunt Site Manager`.
- Publishing makes one commit to `main` through the GitHub API, which triggers the site's normal publish workflow.
- `build.sh` builds the app and .dmg on a Mac. The **Build Mac app** workflow runs it on every change to
  `mac-app/` and replaces the `mac-app` release download.
- Try the editor without a Mac or the real site: `node mac-app/dev/mock-github.mjs` and open
  http://localhost:8765/ (a pretend GitHub holding this checkout's content in memory).
