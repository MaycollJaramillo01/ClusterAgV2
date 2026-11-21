import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

// Renderiza la vista real del archivo principal sin montar App ni iniciar
// autenticacion. Asi se detectan referencias ausentes que el build acepta.
const source = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8');
const mountIndex = source.indexOf('const root = createRoot(');
assert.ok(mountIndex > 0, 'Se debe excluir el montaje de App de esta prueba');
const { outputFiles } = await build({
    stdin: {
        contents: `${source.slice(0, mountIndex)}\nexport { ReportsView, PerformanceView };`,
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        loader: 'jsx'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // Server render only: Astryx stylesheets and theme fonts are not needed here.
    loader: { '.css': 'empty', '.woff2': 'empty', '.woff': 'empty' },
    external: ['react', 'react-dom', 'react-dom/*'],
    write: false,
    plugins: [{
        name: 'no-auth-startup',
        setup(builder) {
            builder.onResolve({ filter: /^firebase\// }, (args) => ({ path: args.path, external: true, sideEffects: false }));
            builder.onResolve({ filter: /^\.\/config\/firebase\.js$/ }, () => ({ path: 'config', namespace: 'test' }));
            builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const auth = null, db = null, appId = "test";' }));
        }
    }]
});
class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-19T18:00:00.000Z'])); }
    static now() { return new FixedDate().getTime(); }
}
const module = { exports: {} };
vm.runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url),
    console, Date: FixedDate, TextEncoder, TextDecoder, Buffer, Uint8Array,
});
const { ReportsView, PerformanceView } = module.exports;
const renderReports = (props = {}) => renderToStaticMarkup(React.createElement(ReportsView, {
    accountTasks: [], editingTasks: [], managementTasks: [],
    clients: [], managers: [], editors: [], users: [], ...props
})).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('Rendimiento no reduce el promedio por tareas de hoy que aun no vencieron', () => {
    const delivered = Array.from({ length: 5 }, (_, index) => ({
        id: `done-${index}`, contextId: 'm1', date: '2026-10-16',
        status: 'publicado', completedAt: '2026-10-16T15:00:00-06:00'
    }));
    const text = renderToStaticMarkup(React.createElement(PerformanceView, {
        accountTasks: [...delivered, { id: 'pending', contextId: 'm1', date: '2026-10-19', time: '23:59', status: 'por_disenar' }],
        managers: [{ id: 'm1', name: 'Account Test' }],
    })).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /KPI promedio 100%/);
    assert.match(text, /0 tareas vencidas/);
});

test('Reportes abre con tareas en las tres salas sin referencias indefinidas', () => {
    const task = { date: '2026-10-19', contextId: 'person', status: 'publicado' };
    const text = renderReports({
        accountTasks: [{ ...task, id: 'account' }],
        editingTasks: [{ ...task, id: 'editing' }],
        managementTasks: [{ ...task, id: 'management', status: 'cerrado' }]
    });
    assert.match(text, /Total Piezas 2 accounts \+ edición/);
    assert.match(text, /Sala Accounts 1 1 publicadas/);
    assert.match(text, /Sala Edición 1 1 publicadas/);
});

test('Reportes incluye los limites del rango y excluye fechas externas o ausentes', () => {
    const tasks = ['2026-09-30', '2026-10-01', '2026-10-19', '2026-10-20', ''].map((date, id) => ({
        id: String(id), date, status: 'publicado'
    }));
    const text = renderReports({ accountTasks: tasks, editingTasks: tasks, managementTasks: tasks });
    assert.match(text, /Total Piezas 4 accounts \+ edición/);
    assert.match(text, /Sala Accounts 2 2 publicadas/);
    assert.match(text, /Sala Edición 2 2 publicadas/);
});

test('Reportes expandido incluye todas las secciones en la captura', () => {
    const task = { date: '2026-10-19', contextId: 'person', status: 'publicado' };
    const text = renderReports({
        expandAllSections: true,
        accountTasks: [{ ...task, id: 'account' }],
        editingTasks: [{ ...task, id: 'editing' }],
        managementTasks: [{ ...task, id: 'management', status: 'cerrado' }],
        managers: [{ id: 'person', name: 'Ana' }],
        editors: [{ id: 'person', name: 'Leo' }],
    });
    assert.match(text, /Piezas de contenido/);
    assert.match(text, /Diario por usuario/);
    assert.match(text, /Por manager/);
    assert.match(text, /Por editor/);
    assert.match(text, /Gestión/);
});
