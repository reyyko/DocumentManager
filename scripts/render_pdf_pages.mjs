#!/usr/bin/env node

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

if (!globalThis.DOMMatrix) {
  globalThis.DOMMatrix = DOMMatrix;
}
if (!globalThis.ImageData) {
  globalThis.ImageData = ImageData;
}
if (!globalThis.Path2D) {
  globalThis.Path2D = Path2D;
}

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(target, width, height) {
    target.canvas.width = width;
    target.canvas.height = height;
  }

  destroy(target) {
    target.canvas.width = 0;
    target.canvas.height = 0;
  }
}

function parseArgs(argv) {
  const result = {
    filePath: '',
    maxPages: 4,
    forceImages: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!result.filePath && !current.startsWith('--')) {
      result.filePath = current;
      continue;
    }

    if (current === '--max-pages') {
      result.maxPages = Number(argv[index + 1] ?? 4);
      index += 1;
      continue;
    }

    if (current === '--force-images') {
      result.forceImages = true;
    }
  }

  return result;
}

async function renderPdfPages(filePath, maxPages, forceImages) {
  const data = await fs.readFile(filePath);
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableWorker: true,
  });

  const pdfDocument = await loadingTask.promise;
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rendered-pdf-'));
  const canvasFactory = new NodeCanvasFactory();
  const pages = [];
  const textParts = [];
  const pageLimit = Math.min(pdfDocument.numPages, Math.max(1, maxPages));

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const textExcerpt = String(textContent.items.map((item) => item.str ?? '').join(' ')).trim();
    const viewport = page.getViewport({ scale: 2 });

    let imagePath = null;
    if (forceImages || !textExcerpt) {
      const target = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({
        canvasContext: target.context,
        viewport,
        canvasFactory,
      }).promise;

      imagePath = path.join(outputDir, `page-${pageNumber}.png`);
      await fs.writeFile(imagePath, target.canvas.toBuffer('image/png'));
      canvasFactory.destroy(target);
    }

    if (textExcerpt) {
      textParts.push(textExcerpt);
    }

    pages.push({
      page: pageNumber,
      imagePath,
      textExcerpt: textExcerpt || undefined,
    });
  }

  return {
    outputDir,
    textExcerpt: textParts.join('\n').trim() || undefined,
    pages,
  };
}

async function main() {
  const { filePath, maxPages, forceImages } = parseArgs(process.argv.slice(2));
  if (!filePath) {
    console.error(JSON.stringify({ error: 'Missing PDF path' }));
    process.exit(1);
  }

  const payload = await renderPdfPages(path.resolve(filePath), maxPages, forceImages);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
