import PDFDocument from 'pdfkit';

export const createPdfDocument = (options = {}) => (
    new PDFDocument({ size: 'A4', margin: 40, ...options })
);
