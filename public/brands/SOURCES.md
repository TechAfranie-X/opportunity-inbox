# Brand assets

Full-colour marks bundled for company identity (see lib/identity/brand-assets.ts). Each file is the company's own published icon (the SVG or
apple-touch-icon its homepage declares), fetched once by a developer with scripts/identity/fetch-brand-assets.py and checked by eye. The product
never fetches a logo at run time and never sends a company name anywhere. Trademarks remain their owners'; marks are shown only to identify the employer.
Single-colour glyphs for ~90 other companies (drawn in their official brand colour) come from simple-icons (CC0) in lib/identity/logos.ts.

| File | Source |
|---|---|
| harvey.png | harvey.ai (site icon) |
| ramp.png | ramp.com (apple-touch-icon) |
| plaid.svg | plaid.com (mask icon) |
| figma.svg | figma.com (site icon) |
| google.png | google.com (favicon, 32 px) |
| slack.png | slack.com (site icon, 35 px) |
| toast.png | toasttab.com (site icon, 31 px) |
| waymo.png | waymo.com (apple-touch-icon) |
| neuralink.png | neuralink.com (site icon) |
| brex.png | brex.com (favicon, 48 px) |

Rejected after review: anduril, scale, janestreet, mercury, microsoft (placeholder, white-on-transparent or not a logo).
To add a company: fetch, look at it, add an entry to brand-assets.ts, and say whether it is an app-style icon ("bleed") or a free-standing mark ("inset").
