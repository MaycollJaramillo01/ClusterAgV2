export const parseByteRange = (header, size) => {
    if (!header || !Number.isFinite(size) || size <= 0) return null;
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
    if (!match) return null;
    const startText = match[1];
    const endText = match[2];
    if (startText === '' && endText === '') return null;
    if (startText === '') {
        const suffix = Number(endText);
        if (!Number.isInteger(suffix) || suffix <= 0) return null;
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(startText);
    if (!Number.isInteger(start) || start < 0 || start >= size) return { unsatisfiable: true };
    const end = endText === '' ? size - 1 : Number(endText);
    if (!Number.isInteger(end) || end < start) return { unsatisfiable: true };
    return { start, end: Math.min(end, size - 1) };
};
