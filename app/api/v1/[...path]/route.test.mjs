import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from './route.ts';

const originalFetch = globalThis.fetch;
const originalBackendUrl = process.env.BACKEND_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBackendUrl === undefined) {
    delete process.env.BACKEND_URL;
  } else {
    process.env.BACKEND_URL = originalBackendUrl;
  }
});

test('streams multipart uploads with boundary, auth, size, and upstream status preserved', async () => {
  const multipart = new TextEncoder().encode(
    '--mesh-boundary\r\nContent-Disposition: form-data; name="file"; filename="mesh.glb"\r\n\r\nmesh-data\r\n--mesh-boundary--\r\n'
  );
  const receivedChunks = [];
  let receivedHeaders;
  let releaseUpload;
  let uploadComplete = false;
  let resolveFirstChunk;
  const firstChunkReceived = new Promise(resolve => {
    resolveFirstChunk = resolve;
  });
  const server = createServer((incoming, outgoing) => {
    receivedHeaders = incoming.headers;
    incoming.on('data', chunk => {
      receivedChunks.push(chunk);
      if (receivedChunks.length === 1) resolveFirstChunk();
    });
    incoming.on('end', () => {
      outgoing.writeHead(413).end('Payload too large');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.BACKEND_URL = `http://127.0.0.1:${address.port}`;

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(multipart.slice(0, 32));
      releaseUpload = () => {
        if (uploadComplete) return;
        controller.enqueue(multipart.slice(32));
        controller.close();
        uploadComplete = true;
      };
    },
  });
  const request = new NextRequest('http://localhost/api/v1/file-upload/mesh', {
    method: 'POST',
    headers: {
      'content-type': 'multipart/form-data; boundary=mesh-boundary',
      'content-length': String(multipart.byteLength),
      authorization: 'Bearer upload-token',
    },
    body,
    duplex: 'half',
  });

  let upstreamInit;
  const actualFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    upstreamInit = init;
    return actualFetch(_input, init);
  };

  let responsePromise;
  try {
    responsePromise = POST(request, { params: Promise.resolve({ path: ['file-upload', 'mesh'] }) });
    const firstChunkArrived = await Promise.race([
      firstChunkReceived.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 3000)),
    ]);
    assert.equal(firstChunkArrived, true, 'backend should receive bytes while the client stream is still open');
    assert.equal(uploadComplete, false);
    releaseUpload();

    const response = await responsePromise;
    const headers = new Headers(upstreamInit.headers);

    assert.equal(response.status, 413);
    assert.equal(await response.text(), 'Payload too large');
    assert.equal(upstreamInit.body, request.body);
    assert.equal(upstreamInit.duplex, 'half');
    assert.equal(headers.get('content-type'), 'multipart/form-data; boundary=mesh-boundary');
    assert.equal(headers.get('content-length'), String(multipart.byteLength));
    assert.equal(headers.get('authorization'), 'Bearer upload-token');
    assert.deepEqual(Buffer.concat(receivedChunks), Buffer.from(multipart));
    assert.equal(receivedHeaders['content-type'], 'multipart/form-data; boundary=mesh-boundary');
    assert.equal(receivedHeaders.authorization, 'Bearer upload-token');
    assert.equal(Number(receivedHeaders['content-length']), multipart.byteLength);
  } finally {
    releaseUpload?.();
    await responsePromise?.catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
});

test('aborting the incoming request aborts the upstream POST', async () => {
  process.env.BACKEND_URL = 'http://127.0.0.1:7842';
  const client = new AbortController();
  const request = new NextRequest('http://localhost/api/v1/file-upload/mesh', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=mesh-boundary' },
    body: new ReadableStream(),
    signal: client.signal,
    duplex: 'half',
  });

  let upstreamSignal;
  let notifyFetchStarted;
  const fetchStarted = new Promise(resolve => {
    notifyFetchStarted = resolve;
  });
  globalThis.fetch = async (_input, init) => {
    upstreamSignal = init.signal;
    notifyFetchStarted();
    return new Promise((_resolve, reject) => {
      upstreamSignal.addEventListener('abort', () => reject(upstreamSignal.reason), { once: true });
    });
  };

  const responsePromise = POST(request, { params: Promise.resolve({ path: ['file-upload', 'mesh'] }) });
  await fetchStarted;
  client.abort(new Error('client disconnected'));

  const response = await responsePromise;
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(response.status, 500);
});