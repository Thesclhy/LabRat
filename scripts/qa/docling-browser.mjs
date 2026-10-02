import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const playwright = process.env.LABRAT_PLAYWRIGHT_MODULE;
if (!playwright) throw new Error('Set LABRAT_PLAYWRIGHT_MODULE to the existing Playwright module.');
const { chromium } = await import(pathToFileURL(playwright));
const output = path.resolve('artifacts/docling-pdf-pages/browser');
const phase = process.argv[2] || 'paper';
const startedAt = new Date().toISOString(), records = [], errors = [];
const browser = await chromium.launch({ executablePath: process.env.LABRAT_CHROMIUM, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: 'http://127.0.0.1:5178',
  storageState: path.join(output, 'auth.json') });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const route = '/LabRat/projects/project_analysis/references', api = '/api/v1/projects/project_analysis';
const record = async (step, detail = {}) => {
  records.push({ step, ...detail }); console.log(JSON.stringify(records.at(-1)));
  await fs.writeFile(path.join(output, `${phase}-results.json`), JSON.stringify({ startedAt, phase, records, errors }, null, 2));
  await fs.writeFile(path.join(output, `${phase}-${startedAt.replace(/[:.]/g, '-')}-results.json`), JSON.stringify({ startedAt, phase, records, errors }, null, 2));
};
const waitUntil = async (read, predicate, timeout = 120000) => {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read(); if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Observable state did not settle: ${JSON.stringify(value)}`);
};
const json = async (url, options) => { const response = await page.request.get(url, options); assert.equal(response.status(), 200, await response.text()); return response.json(); };
const doc = async (name) => (await json(`${api}/context-documents?search=${encodeURIComponent(name)}`)).items.find((item) => item.document.originalName === name);
const row = (name) => page.locator('.reference-row').filter({ has: page.getByRole('button', { name, exact: true }) });
const versionReady = (id) => waitUntil(() => json(`${api}/context-document-versions/${id}`).then((v) => v.version), (v) => ['ready', 'partial', 'failed'].includes(v.status), 180000);
const library = page.getByRole('region', { name: 'Reference library', exact: true });
const upload = async (filename, name) => {
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/context-documents'));
  await library.locator('input[type=file]').setInputFiles(name ? { name, mimeType: 'application/pdf', buffer: await fs.readFile(filename) } : filename);
  const registered = await response; assert.equal(registered.status(), 201, await registered.text());
  return registered.json();
};
const rendered = async () => {
  const img = page.getByRole('dialog').getByRole('img');
  await img.waitFor(); await waitUntil(() => img.evaluate((n) => n.complete && n.naturalWidth > 0), Boolean, 30000);
  return img;
};
const close = () => page.getByRole('button', { name: 'Close source evidence' }).click();
const open = async (name) => { await row(name).getByRole('button', { name, exact: true }).click(); await rendered(); };
const textOfPage = async () => {
  const section = page.getByRole('dialog').locator('.qa-page-text');
  const show = section.getByRole('button', { name: 'Show page text' }); await show.click();
  const more = section.getByRole('button', { name: 'Load more page text' });
  let windows = 1;
  while (await more.count()) {
    const previous = await section.locator('pre').textContent();
    await more.click(); await waitUntil(() => section.locator('pre').textContent(), (value) => value.length > previous.length, 10000);
    if (++windows > 501) throw new Error('Page text pagination did not finish.');
  }
  const text = await section.locator('pre').textContent();
  await section.getByRole('button', { name: 'Hide page text' }).click();
  return { text, windows };
};
const fold = (text) => text.replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
try {
  await page.goto(route); await page.getByRole('heading', { name: 'Reference library', exact: true }).waitFor();
  if (phase === 'paper' || phase === 'paper-pages') {
    const filename = process.env.LABRAT_DOCLING_QA_PAPER;
    const name = path.basename(filename);
    if (phase === 'paper') {
    const registered = await upload(filename);
    await record('upload-paper', { name, versionId: registered.version.id, initialStatus: registered.version.status });
    await page.reload(); await row(name).getByRole('button', { name: 'Cancel reading', exact: true }).click();
    await waitUntil(() => doc(name), (item) => item?.currentVersion?.failureCode === 'document_cancelled');
    await row(name).getByRole('button', { name: 'Retry', exact: true }).click();
    await page.reload(); const version = await versionReady(registered.version.id);
    assert.equal(version.metadata.pageCount, 11); assert.equal(version.status, 'partial');
    await record('cancel-retry-refresh', { versionId: version.id, status: version.status, pageCount: version.metadata.pageCount });
    }
    await page.reload(); await open(name);
    const goldens = JSON.parse(await fs.readFile('doc/qa/docling-pdf-pages-goldens.json', 'utf8'));
    for (let number = 1; number <= 11; number++) {
      if (number > 1) await page.getByRole('combobox', { name: 'Page', exact: true }).selectOption(String(number));
      const img = await rendered(); const result = await textOfPage();
      const anchors = goldens.anchors.filter((anchor) => anchor.page === number);
      for (const anchor of anchors) assert.ok(fold(result.text).includes(fold(anchor.text)), `Missing page ${number} anchor ${anchor.text}`);
      await img.screenshot({ path: path.join(output, `paper-page-${number}.png`) });
      await record('paper-page', { page: number, characters: result.text.length, windows: result.windows, anchors: anchors.length });
    }
    await close(); await page.reload(); await open(name); await rendered();
    await record('saved-pages-after-refresh'); await close();
  }
  if (phase === 'fixtures') {
    for (const name of ['native', 'scan', 'mixed', 'blank', 'low-quality', 'encrypted', 'corrupt']) {
      const registered = await upload(path.resolve(`artifacts/docling-pdf-pages/fixtures/${name}.pdf`));
      const version = await versionReady(registered.version.id); await page.reload();
      if (['encrypted', 'corrupt'].includes(name)) {
        assert.equal(version.status, 'failed'); assert.equal(version.failureCode, `document_${name}`);
        await row(`${name}.pdf`).getByRole('button', { name: 'Retry', exact: true }).click();
        const again = await versionReady(registered.version.id); assert.equal(again.failureCode, version.failureCode);
        await record(name, { status: version.status, failureCode: version.failureCode, explicitRetry: true }); continue;
      }
      await open(`${name}.pdf`);
      if (name === 'blank') await page.getByText('Blank page', { exact: true }).waitFor();
      else {
        const result = await textOfPage();
        if (name === 'scan') { assert.ok(result.text.includes('催化剂')); assert.ok(result.text.includes('Zn/b-ZnO')); }
        if (name === 'mixed') { assert.equal(result.text.split('NATIVE-HEADER').length - 1, 1); assert.ok(result.text.includes('SCAN-REGION')); }
        if (name === 'low-quality') await page.getByText(/Very little text could be recognized/).waitFor();
        if (name === 'native') {
          await page.getByRole('combobox', { name: 'Page', exact: true }).selectOption('2'); await rendered();
          const rotated = await textOfPage(); assert.ok(rotated.text.includes('ROTATED-90')); await rendered();
          await page.getByRole('dialog').screenshot({ path: path.join(output, 'native-rotated.png') });
          await page.getByRole('combobox', { name: 'Page', exact: true }).selectOption('3'); await rendered();
          const long = await textOfPage(); assert.ok(long.text.length > 6000); assert.ok(long.text.includes('中文🔬ZnO −12.5 °C'));
          await record('native-long', { characters: long.text.length, windows: long.windows });
        }
      }
      await page.getByRole('dialog').screenshot({ path: path.join(output, `${name}-viewer.png`) });
      await record(name, { status: version.status, pageCount: version.metadata.pageCount }); await close();
    }
  }
  if (phase === 'citations') {
    const ask = page.getByRole('textbox', { name: 'Ask LabRat', exact: true });
    if (!await page.locator('.agent.open').count()) await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const query = async (name, question) => {
      const selected = page.getByLabel('Selected references');
      while (await selected.getByRole('button').count()) await selected.getByRole('button').first().click();
      await ask.fill(`@${name}`); await page.getByRole('option').filter({ has: page.getByText(name, { exact: true }) }).click();
      await ask.fill(question);
      const sent = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/research-questions'));
      await page.getByRole('button', { name: 'Send message' }).click();
      const result = await (await sent).json(); const id = result.request.runId;
      const completed = await waitUntil(() => json(`${api}/research-questions/${id}`), (v) => v.request.status === 'completed', 15000);
      const card = page.locator('.ask-cited-answer').last(); await card.getByText('Source links open the versions read for this answer.').waitFor();
      return { id, card, completed };
    };
    const old = await query('Legacy native.pdf', 'Only use this PDF. Read page 1.');
    await old.card.locator('.qa-citations button').first().click(); await rendered();
    assert.equal(await page.getByRole('dialog').locator('.qa-page-text').count(), 0);
    await close();
    await row('Legacy native.pdf').getByRole('button', { name: 'Reprocess PDF' }).click();
    const reprocessed = await waitUntil(() => doc('Legacy native.pdf'), (v) => v?.currentVersion?.versionNumber === 2);
    const version = await versionReady(reprocessed.currentVersion.id); assert.equal(version.metadata.pageSchemaVersion, 2);
    await old.card.locator('.qa-citations button').first().click(); await rendered();
    assert.ok((await page.getByRole('dialog').getByRole('img').getAttribute('src')).includes(old.completed.artifact.evidence[0].version.versionId));
    await page.getByRole('dialog').screenshot({ path: path.join(output, 'legacy-citation-after-reprocess.png') }); await close();
    await record('legacy-reprocessed-history', { oldVersion: old.completed.artifact.evidence[0].version.versionId, newVersion: version.id });
    const current = await query('native.pdf', 'Only use this PDF. Read page 3.');
    assert.equal(current.completed.artifact.evidence.length, 3);
    await current.card.getByText('Sources read · 1', { exact: true }).click();
    await current.card.getByText('Page 3 · 3 passages', { exact: true }).click();
    await current.card.getByRole('button', { name: 'Passage 2', exact: true }).click(); await rendered();
    assert.ok(await page.locator('.qa-source-highlight').count() > 0);
    await page.getByRole('dialog').screenshot({ path: path.join(output, 'long-page-citation.png') });
    const citedText = await page.getByRole('region', { name: 'Cited text' }).innerText();
    await page.getByRole('combobox', { name: 'Page', exact: true }).selectOption('2'); await rendered();
    assert.equal(await page.locator('.qa-source-highlight').count(), 0);
    await page.getByRole('button', { name: 'Return to cited page 3' }).click(); await rendered();
    assert.equal(await page.getByRole('region', { name: 'Cited text' }).innerText(), citedText);
    await close(); await record('same-page-windows-and-pinned-highlight', { windows: 3 });
    const rotated = await query('native.pdf', 'Only use this PDF. Read page 2.');
    await rotated.card.locator('.qa-citations button').first().click(); await rendered();
    await page.locator('.qa-pdf-page').screenshot({ path: path.join(output, 'rotated-citation.png') }); await close();
    await record('rotated-highlight');
    await page.reload(); await page.getByRole('heading', { name: 'Reference library', exact: true }).waitFor();
    if (!await page.locator('.agent.open').count()) await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.locator('.ask-cited-answer').last().locator('.qa-citations button').first().click(); await rendered(); await close();
    await record('answer-and-source-after-refresh');
  }
  if (phase === 'narrow') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); await page.getByRole('heading', { name: 'Reference library', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'narrow-library.png'), fullPage: true });
    const width = await page.evaluate(() => ({ viewport: window.innerWidth, body: document.documentElement.scrollWidth }));
    assert.ok(width.body <= width.viewport + 1, JSON.stringify(width));
    await open('scan.pdf'); await textOfPage();
    await page.getByRole('dialog').screenshot({ path: path.join(output, 'narrow-scan.png') });
    assert.ok(await page.getByRole('dialog').evaluate((n) => n.scrollWidth <= n.clientWidth + 1));
    await close(); await record('narrow-library-and-page-text', width);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.waitForURL('**/overview'); await page.goBack(); await page.waitForURL('**/references');
    await page.goForward(); await page.waitForURL('**/overview'); await record('browser-back-forward');
  }
  assert.deepEqual(errors, []);
  await record('phase-complete');
} catch (error) {
  await page.screenshot({ path: path.join(output, `${phase}-failure-${Date.now()}.png`), fullPage: true }).catch(() => {});
  await record('failure', { message: error.message }); throw error;
} finally { await browser.close(); }
