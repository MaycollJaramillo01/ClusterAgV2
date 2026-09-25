import assert from 'node:assert/strict';
import test from 'node:test';
import { buildR2CorsOrigins, buildR2CorsRules } from './r2-cors.js';

test('R2 CORS includes local, production and native shells', () => {
    const origins = buildR2CorsOrigins({
        appBaseUrl: 'https://clusterag.vercel.app/',
        extra: 'https://preview.example.test,capacitor://localhost'
    });
    assert.ok(origins.includes('https://clusterag.vercel.app'));
    assert.ok(origins.includes('http://127.0.0.1:3000'));
    assert.ok(origins.includes('capacitor://localhost'));
    assert.ok(origins.includes('https://preview.example.test'));
    assert.equal(origins.filter((item) => item === 'capacitor://localhost').length, 1);
});

test('R2 CORS rules allow signed PUT from the browser', () => {
    const [rule] = buildR2CorsRules(['https://clusterag.vercel.app']);
    assert.deepEqual(rule.AllowedMethods, ['GET', 'PUT', 'HEAD']);
    assert.ok(rule.AllowedHeaders.includes('*'));
    assert.ok(rule.ExposeHeaders.includes('ETag'));
});
