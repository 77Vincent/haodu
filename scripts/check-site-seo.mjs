import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Only reads Hugo's generated tags (including minified, unquoted attributes).
function tags(source, name) {
  return [...source.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))].map(([, attributes]) =>
    Object.fromEntries([...attributes.matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
      .map(([, key, double, single, bare]) => [key, double ?? single ?? bare])));
}
const alternates = source => Object.fromEntries(
  tags(source, '(?:xhtml:)?link').filter(tag => tag.hreflang).map(tag => [tag.hreflang, tag.href]));

export async function checkSiteSeo(destination, releaseURL) {
  const base = releaseURL || new URL('https://preview.invalid/');
  const homeAlternates = {
    'x-default': new URL('', base).href,
    'zh-cn': new URL('', base).href,
    en: new URL('en/', base).href,
  };
  const languageTargets = new Map(Object.entries(homeAlternates));
  function artifactPath(href) {
    const url = new URL(href, base);
    assert.equal(url.origin, base.origin, `Unexpected external SEO asset: ${href}`);
    assert(url.pathname.startsWith(base.pathname), `SEO URL outside release path: ${href}`);
    return join(destination, decodeURIComponent(url.pathname.slice(base.pathname.length)));
  }
  function absoluteAlternates(source) {
    return Object.fromEntries(Object.entries(alternates(source)).map(([lang, href]) =>
      [lang, new URL(href, base).href]));
  }
  const indexable = new Map();
  for (const page of ['index.html', 'en/index.html', 'privacy/index.html', '404.html', 'en/404.html']) {
    const html = await readFile(join(destination, page), 'utf8');
    const head = html.split('</head>')[0];
    const metas = tags(head, 'meta');
    const meta = key => {
      const values = metas.filter(tag => (tag.name || tag.property) === key);
      assert.equal(values.length, 1, `${page}: expected one ${key}`);
      assert(values[0].content?.trim(), `${page}: empty ${key}`);
      return values[0].content;
    };
    const errorPage = page.endsWith('404.html');
    const locale = tags(html, 'html')[0]?.lang;
    assert.equal(locale, page.startsWith('en/') ? 'en-US' : 'zh-CN');
    assert.equal([...head.matchAll(/<title>[^<]+<\/title>/g)].length, 1, `${page}: missing/duplicate title`);
    assert.equal(tags(html, 'h1').length, 1, `${page}: expected one H1`);
    meta('description');
    const canonical = tags(head, 'link').filter(tag => tag.rel === 'canonical');
    assert.equal(canonical.length, 1, `${page}: expected one canonical`);
    const expected = new URL(page.replace(/index\.html$/, ''), base).href;
    assert.equal(new URL(canonical[0].href, base).href, expected, `${page}: incorrect canonical`);
    if (releaseURL) assert.equal(canonical[0].href, expected, `${page}: canonical must be absolute`);
    const robots = metas.filter(tag => tag.name === 'robots').map(tag => tag.content).join(',');
    assert.equal(/\bnoindex\b/.test(robots), !releaseURL || errorPage, `${page}: incorrect indexing policy`);
    assert.equal(new URL(meta('og:url'), base).href, expected);
    for (const key of ['og:title', 'og:description', 'og:site_name', 'og:locale', 'og:type',
      'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt']) meta(key);
    assert.equal(meta('twitter:card'), 'summary_large_image');
    const image = meta('og:image');
    assert.equal(meta('twitter:image'), image);
    if (releaseURL) assert.equal(new URL(image, base).href, image, `${page}: share image must be absolute`);
    assert((await stat(artifactPath(image))).size > 0, `${page}: share image was not published`);
    assert(Number(meta('og:image:width')) > 0 && Number(meta('og:image:height')) > 0);
    const schemas = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attributes]) => /type=["']?application\/ld\+json/.test(attributes))
      .flatMap(([, , body]) => { const data = JSON.parse(body); return data['@graph'] || [data]; });
    assert(schemas.length > 0, `${page}: missing JSON-LD`);
    if (page === 'index.html' || page === 'en/index.html') {
      assert.deepEqual(absoluteAlternates(head), homeAlternates, `${page}: incorrect language links`);
      const schema = schemas.find(item => item['@type'] === 'WebSite');
      assert(schema, `${page}: missing WebSite schema`);
      assert.equal(new URL(schema.url, base).href, base.href);
      assert.equal(schema.name, meta('og:site_name'), `${page}: incorrect localized website name`);
      languageTargets.set(locale.toLowerCase(), expected);
    }
    if (!errorPage) indexable.set(expected, absoluteAlternates(head));
  }
  const robots = await readFile(join(destination, 'robots.txt'), 'utf8');
  assert.equal(/^Disallow:\s*\/\s*$/m.test(robots), !releaseURL, 'Incorrect robots.txt policy');
  if (!releaseURL) return;
  assert(robots.includes(`Sitemap: ${new URL('sitemap.xml', base).href}`));
  const sitemapIndex = await readFile(join(destination, 'sitemap.xml'), 'utf8');
  const sitemaps = [...sitemapIndex.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, href]) => href);
  assert(sitemaps.length > 0, 'Empty sitemap index');
  const listed = new Set();
  for (const href of sitemaps) {
    const xml = await readFile(artifactPath(href), 'utf8');
    for (const [, entry] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = entry.match(/<loc>([^<]+)<\/loc>/)?.[1];
      assert(indexable.has(loc), `Sitemap contains a non-indexable or unexpected URL: ${loc}`);
      // The theme uses locales in XML and language codes in HTML. XML may omit
      // x-default; require correct destinations and complete reciprocal links.
      const links = absoluteAlternates(entry);
      for (const [language, target] of Object.entries(links)) {
        assert.equal(target, languageTargets.get(language.toLowerCase()), `Incorrect sitemap language target: ${loc}`);
      }
      assert.deepEqual(new Set(Object.values(links)), new Set(Object.values(indexable.get(loc))),
        `Sitemap omits a language alternative: ${loc}`);
      listed.add(loc);
    }
  }
  assert.deepEqual(listed, new Set(indexable.keys()), 'Sitemap omits an indexable page');
}
