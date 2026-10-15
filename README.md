# Scott Hunt Photography website

A fast, hand-built photography site hosted free on GitHub Pages, edited through a simple online editor.

## How the site is organized
- **Entrance** (`/`): the coin intro (Variation 6, `src/intro/`). When it ends, the left coin leads to the photography side and the right coin to Rock'n H.
- **Scott Hunt Photography** (`/photography/`): white pages with a sidebar of galleries, About and Contact. Each gallery shows one photo at a time with arrows, plus a *show thumbnails* grid.
- **Rock'n H** (`/rockn-h/`): the sales and marketing side, including the Prints page. In the editor, each page has a *Which side of the site* setting.

## Editing the site (no code needed)

1. Go to **https://app.pagescms.org** and sign in with GitHub.
2. Open this repository. You'll see **Galleries**, **Pages** and **Site settings**.
3. Make changes and press **Save**. The live site updates about a minute later.

### Photos and galleries
- **Add photos:** open a gallery, click *Add an entry* under Photos, then pick or upload an image.
- **Remove photos:** click the trash icon on a photo. The layout adjusts automatically.
- **Reorder photos:** drag them up or down.
- **Move a photo to another gallery:** add it to the new gallery (it's already in the media library) and delete it from the old one.
- **New gallery:** Galleries → *Add an entry*. It joins the Galleries menu automatically.
- **Layouts:** each gallery can be Masonry (keeps each photo's shape), Grid (even squares) or One large photo at a time.

### Pages
- **New page:** Pages → *Add an entry*. Turn on *Show in menu* to add it to the navigation.
- **Delete a page or gallery:** open its menu (⋯) in the list and choose *Delete*.
- **Contact form:** turn on *Show the contact form* for any page.

### Drafts: build in the background, publish when ready
Every new gallery and page starts as a **Draft**. Drafts never appear in the menu or search engines.
Preview them at `your-site/drafts/`. When it's ready, turn off **Draft** and save — that's publishing.

### Sub-menus of galleries
To put a gallery in a sub-menu (for example under Pocket Pictures), type the main gallery's web address, such as `pocket-pictures`, in *Show in a sub-menu under another gallery*. The main gallery's page then shows a grid of its sub-galleries.

### Selling limited-edition prints (Rock'n H)
Prints are sold on the Rock'n H side, from **Rock'n H print collections** in the editor.
- Each print has a photo, title, description, edition size and prints sold so far.
- Prices come from a **price list**: rows of *material*, *size* and *price*. Put one price list on the collection and every print in it uses it; give a print its own list only when it differs. Visitors see **Prices from $X**, pick a material and size on the print page, and add it to the cart.
- Checkout is **PayPal** (cards accepted without a PayPal account). Paste your PayPal **Live Client ID** into *Site settings → Checkout*. Until then the cart says online checkout is being set up. Never paste the PayPal *Secret* anywhere.
- Prints with no price list show an **Enquire** button that opens the Rock'n H contact form.
- When *prints sold* reaches the edition size, the print shows **Sold out**.
- The print-page drop-downs (About the Prints, Limited Editions, Dimensions and Borders, Shipping and Production Times) are edited in **Site settings**.
- Turn on *Show on the Rock'n H home page* to feature a print.
- The Rock'n H home page text (heading, artist statement, about, newsletter) is in **Site settings**.

### Home page
Site settings → *Home page slideshow*: choose the photos that fade in behind your name, and drag to reorder.

## One-time setup
- **Hosting:** repository Settings → Pages → Source: **GitHub Actions**. Each save publishes automatically.
- **Contact form:** get a free access key at web3forms.com (sent to your email) and paste it into Site settings → *Web3Forms access key*.
- **Your domain:** put `www.scotthuntphoto.com` in Site settings → *Custom domain*, add it under repository Settings → Pages, and point the domain's DNS `www` CNAME record to `<username>.github.io`.

## Technical notes
- `content/` holds all text and gallery lists (JSON); `photos/` holds images; `build.mjs` turns them into the site in `dist/` with no dependencies (`node build.mjs`).
- Upload photos sized for the web (about 2500px on the long edge, JPEG quality ~80) so pages load quickly.
