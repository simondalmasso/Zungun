import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const publicDir = path.join(root, 'cloudflare/public');
const origin = 'https://zungun.simondalmasso44.workers.dev';

const pages = [
  {
    file: 'index.html',
    route: '/',
    title: 'Zungun — Reliable delivery for critical field operations',
    heading: 'Know what actually happened.',
    indexable: true,
  },
  {
    file: 'developers/index.html',
    route: '/developers',
    title: 'Zungun for Developers — Offline-First Android Delivery SDK',
    heading: 'Durability without optimistic claims.',
    indexable: true,
  },
  {
    file: 'control/index.html',
    route: '/control',
    title: 'Zungun Control — Field Operations Demo',
    heading: 'Assign work. See proof.',
    indexable: false,
  },
  {
    file: 'messages/index.html',
    route: '/messages',
    title: 'Zungun Messages — Delivery State Demo',
    heading: 'Text. No pretend presence.',
    indexable: false,
  },
  {
    file: 'ops/index.html',
    route: '/ops',
    title: 'Zungun Ops — Execution Evidence',
    heading: 'Inspect what supports the claim.',
    indexable: false,
  },
];

function metaContent(html, key, selectorAttribute = 'name') {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!tag.includes(selectorAttribute + '="' + key + '"')) continue;
    const match = tag.match(/\bcontent="([^"]*)"/i);
    if (match) return match[1];
  }
  return null;
}

function linkHref(html, rel) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!tag.includes('rel="' + rel + '"')) continue;
    const match = tag.match(/\bhref="([^"]*)"/i);
    if (match) return match[1];
  }
  return null;
}

for (const page of pages) {
  test('public-site SEO contract: ' + page.route, () => {
    const html = fs.readFileSync(path.join(publicDir, page.file), 'utf8');
    const canonical = origin + page.route;
    const description = metaContent(html, 'description');

    assert.match(html, /<html lang="en">/i);
    assert.equal(html.match(/<title>/gi)?.length, 1, 'exactly one title element');
    assert.equal(html.match(/<h1\b/gi)?.length, 1, 'exactly one primary heading');
    assert.ok(html.includes(page.heading), 'primary heading should match the page purpose');
    assert.equal(html.match(/<meta name="viewport"/gi)?.length, 1);
    assert.ok(description, 'description metadata is required');
    assert.ok(description.length >= 70 && description.length <= 165, 'description should be concise');
    assert.match(html, /<link rel="canonical"/i);
    assert.equal(linkHref(html, 'canonical'), canonical);
    assert.equal(linkHref(html, 'icon'), '/favicon.svg');
    assert.equal(metaContent(html, 'og:title', 'property'), page.title);
    assert.equal(metaContent(html, 'og:description', 'property'), description);
    assert.equal(metaContent(html, 'og:url', 'property'), canonical);
    assert.equal(metaContent(html, 'og:image', 'property'), origin + '/og-card.svg');
    assert.equal(metaContent(html, 'twitter:card'), 'summary_large_image');
    assert.equal(
      metaContent(html, 'robots'),
      page.indexable ? 'index,follow,max-image-preview:large' : 'noindex,nofollow,noarchive',
    );
  });
}

test('homepage structured data describes the actual product without invented commercial claims', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  assert.ok(match, 'JSON-LD structured data is required');
  const data = JSON.parse(match[1]);
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data['@type'], 'SoftwareApplication');
  assert.equal(data.name, 'Zungun');
  assert.equal(data.url, origin + '/');
  assert.equal(data.applicationCategory, 'DeveloperApplication');
  assert.ok(data.sameAs.includes('https://github.com/simondalmasso/Zungun'));
  assert.doesNotMatch(html, /universal exactly-once guarantee/i);
  assert.match(html, /No universal exactly-once guarantee/i);
});

test('robots and sitemap expose only indexable public pages', () => {
  const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/zungun\.simondalmasso44\.workers\.dev\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow: \/(control|messages|ops|developers)/);

  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((item) => item[1]).sort();
  assert.deepEqual(locations, [origin + '/', origin + '/developers'].sort());
  assert.doesNotMatch(sitemap, /\/(control|messages|ops)(?:<|\/)/);
});

test('brand assets exist and the developer guide does not link to a missing legacy route', () => {
  const favicon = fs.readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8');
  const socialCard = fs.readFileSync(path.join(publicDir, 'og-card.svg'), 'utf8');
  const developers = fs.readFileSync(path.join(publicDir, 'developers/index.html'), 'utf8');
  assert.match(favicon, /<svg\b/i);
  assert.match(socialCard, /<svg\b[^>]*width="1200"[^>]*height="630"/i);
  assert.match(socialCard, /Zungun/);
  assert.doesNotMatch(developers, /href="\/ops\/legacy/);
});
