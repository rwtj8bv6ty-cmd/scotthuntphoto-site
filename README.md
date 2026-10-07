# Scott Hunt Photography website

A fast, hand-built photography site hosted free on GitHub Pages, edited through a simple online editor.

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

### Selling limited-edition prints
On any photo, turn on **Sell as a limited-edition print** and fill in edition size, print size and price.
- The photo appears on the **Prints** page with "x remaining", and shows *Sold out* when sold = edition size.
- For checkout, create a **Stripe Payment Link** (stripe.com → Payment links, set the quantity limit to the edition size) and paste it into *Stripe payment link*. Without a link, buyers get an **Enquire** button that opens the contact form with the photo's name filled in.
- After a sale, raise *Prints sold so far*.

### Home page
Site settings → *Home page slideshow*: choose the photos that fade in behind your name, and drag to reorder.

## One-time setup
- **Hosting:** repository Settings → Pages → Source: **GitHub Actions**. Each save publishes automatically.
- **Contact form:** get a free access key at web3forms.com (sent to your email) and paste it into Site settings → *Web3Forms access key*.
- **Your domain:** put `www.scotthuntphoto.com` in Site settings → *Custom domain*, add it under repository Settings → Pages, and point the domain's DNS `www` CNAME record to `<username>.github.io`.

## Technical notes
- `content/` holds all text and gallery lists (JSON); `photos/` holds images; `build.mjs` turns them into the site in `dist/` with no dependencies (`node build.mjs`).
- Upload photos sized for the web (about 2500px on the long edge, JPEG quality ~80) so pages load quickly.
