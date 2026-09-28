import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveR2Endpoint, resolveR2PublicBaseUrl } from './r2-endpoint.js';

test('R2 endpoint is built from the account id', () => {
    assert.equal(
        resolveR2Endpoint('af64baae836e39459e2bd40ca8c3f9b9', ''),
        'https://af64baae836e39459e2bd40ca8c3f9b9.r2.cloudflarestorage.com'
    );
    assert.equal(
        resolveR2Endpoint('af64baae836e39459e2bd40ca8c3f9b9', 'af64baae836e39459e2bd40ca8c3f9b9'),
        'https://af64baae836e39459e2bd40ca8c3f9b9.r2.cloudflarestorage.com'
    );
});

test('R2 endpoint keeps a full domain URL when provided', () => {
    assert.equal(
        resolveR2Endpoint('abc', 'https://abc.r2.cloudflarestorage.com/'),
        'https://abc.r2.cloudflarestorage.com'
    );
});

test('R2 public base accepts r2.dev hostnames', () => {
    assert.equal(resolveR2PublicBaseUrl(''), '');
    assert.equal(
        resolveR2PublicBaseUrl('pub-123.r2.dev'),
        'https://pub-123.r2.dev'
    );
    assert.equal(
        resolveR2PublicBaseUrl('https://pub-123.r2.dev/'),
        'https://pub-123.r2.dev'
    );
});
