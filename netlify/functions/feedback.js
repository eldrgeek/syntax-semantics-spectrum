'use strict';

/* feedback.js — same-origin proxy for the soma-feedback chip (SOMA App Standard §8).
 *
 * The canonical chip posts cross-origin to a shared service on the VPS. This
 * briefing is unlisted and must not publish that address, so the vendored chip
 * is pointed at this function instead and the real endpoint stays in an env var.
 *
 * Second benefit, which is the reason to prefer this shape generally: the chip's
 * cross-origin load has bitten this estate before. On 2026-07-22 every feedback
 * chip estate-wide went dark at once because the shared host's TLS cert had
 * expired, and the same-origin asset checker was blind to it. A proxy makes the
 * dependency explicit and lets it fail loudly here instead of silently there.
 */

const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };
  }

  const endpoint = process.env.SOMA_FEEDBACK_ENDPOINT;
  if (!endpoint) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ error: 'Feedback endpoint is not configured on this deploy.' }),
    };
  }

  const body = event.body || '{}';

  return new Promise(function (resolve) {
    let u;
    try {
      u = new URL(endpoint);
    } catch (e) {
      return resolve({ statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Bad endpoint config.' }) });
    }

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 20000,
      },
      function (res) {
        let out = '';
        res.on('data', function (c) { out += c; });
        res.on('end', function () {
          resolve({ statusCode: res.statusCode || 502, headers: CORS, body: out || '{}' });
        });
      }
    );
    req.on('timeout', function () { req.destroy(new Error('feedback service timed out')); });
    req.on('error', function (e) {
      resolve({
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'Feedback service unreachable: ' + String(e.message || e) }),
      });
    });
    req.write(body);
    req.end();
  });
};
