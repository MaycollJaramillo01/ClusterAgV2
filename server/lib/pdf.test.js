import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfDocument } from './pdf.js';

test('report PDF renders', async () => {
    const doc = createPdfDocument();
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.fontSize(12).text('Cluster OS');
    doc.end();
    await new Promise((resolve, reject) => {
        doc.once('end', resolve);
        doc.once('error', reject);
    });
    const buffer = Buffer.concat(chunks);
    assert.ok(buffer.length > 100);
    assert.equal(buffer.slice(0, 4).toString(), '%PDF');
});
