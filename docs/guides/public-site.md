# Public site, SEO, and production E2E

## Source of truth

The deployed Cloudflare Worker serves public assets from cloudflare/public/. The Worker explicitly maps /, /control, /messages, /developers, and /ops to their static HTML entry points; other static assets such as /robots.txt, /sitemap.xml, and /favicon.svg use the asset fallback.

apps/public-site/index.html is a local static preview, not the production asset source. The deployed HTML source of truth is cloudflare/public/.

## Indexing contract

- / and /developers are public, indexable landing pages.
- /control, /messages, and /ops are interactive demo surfaces and carry noindex,nofollow,noarchive.
- robots.txt blocks API and diagnostic endpoints, not the noindex pages, so crawlers can read page-level directives.
- sitemap.xml lists only the homepage and developer guide.
- Every HTML route has a unique title, concise description, canonical URL, Open Graph metadata, a Twitter card, and the shared SVG brand assets.
- The JSON-LD SoftwareApplication entry describes the product and links to the canonical repository. It makes no pricing, partnership, certification, satellite, or universal exactly-once claim.

## Metadata and discovery

Recommended GitHub About description:

Android SDK for reliable offline-first delivery of critical field operations, with idempotency, reconciliation, and verifiable execution evidence.

Suggested repository topics:

android-sdk, offline-first, mobile-reliability, idempotency, delivery-assurance, reconciliation, field-operations, distributed-systems, cloudflare-workers, resilience-testing.

These repository discovery settings are separate from page-level SEO metadata and package keywords.

## Static contract tests

Run:

    npm run test:seo

The contract checks route metadata, page titles and headings, structured data, indexability, sitemap/robots behavior, social assets, and known broken internal links.

## Browser E2E with tester-army/e2e

The browser suite uses the open-source tester-army/e2e framework and its Playwright-based web engine. It has no agent steps, model provider, or API key requirement. It is read-only: tests visit the homepage, developer guide, and interactive routes without submitting forms or creating identities.

Requirements: Node.js 22.22.3+ (or 24.8+) and Chromium.

Install the pinned runner without changing the project lockfile:

    npm install --no-save --no-package-lock --no-audit --no-fund e2e@0.21.2 @e2e-dev/web@0.15.2 playwright@1.64.0
    npx playwright install chromium

Run against the local static fixture:

    npm run test:e2e:public

Run against the live Worker:

    APP_URL=https://zungun.simondalmasso44.workers.dev E2E_VIEWPORT=desktop npm run test:e2e:public
    APP_URL=https://zungun.simondalmasso44.workers.dev E2E_VIEWPORT=mobile npm run test:e2e:public

The local fixture rejects mutation methods and returns an unauthenticated response for API reads. Production browser tests only navigate and inspect; they do not click the create-identity form.

## Production release

The workflow .github/workflows/zungun-public-site-release.yml runs on relevant pushes to the canonical branch. It runs static SEO checks and desktop/mobile browser tests against the exact local assets before calling tools/order083/deploy-production.sh, then repeats browser tests against the live Worker.

The release procedure is intentionally the existing guarded ORDER-083 deployment path, not an unreviewed direct Worker upload. It requires the existing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and ZUNGUN_PILOT_TOKEN repository secrets and verifies the deployed source and asset manifests. If a required secret or production invariant is missing, the release fails before it can be considered successful.
