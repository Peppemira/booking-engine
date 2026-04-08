// portalCrawler.js
// Crawls all internal portal pages

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

const PORTAL_DOMAIN = 'ilportaledellautomobilista.it';

module.exports = async function portalCrawler(page, dumpRoot) {
  console.log('Crawling portal pages...');
  await fs.ensureDir(path.join(dumpRoot, 'pages'));

  const visited = new Set();
  const pages = [];

  async function crawl(url) {
    if (visited.has(url)) return;
    visited.add(url);
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      const html = await page.content();
      const fileName = `${Date.now()}_${encodeURIComponent(url)}.html`;
      await fs.writeFile(path.join(dumpRoot, 'pages', fileName), html);
      pages.push({ url, fileName });
      console.log(`Scanning page: ${url}`);
      const $ = cheerio.load(html);
      const links = [];
      $('a[href]').each((_, el) => {
        const link = $(el).attr('href');
        if (link && link.includes(PORTAL_DOMAIN)) {
          links.push(link);
        }
      });
      await Promise.all(links.map(l => crawl(l)));
    } catch (err) {
      console.error('Error crawling page:', url, err);
    }
  }

  await crawl(`https://www.${PORTAL_DOMAIN}`);
  return pages;
};
