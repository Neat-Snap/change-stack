import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'change-stack-tls-'));
const binary = resolve('dist/cstack');
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  const ca = join(directory, 'ca.pem'), caKey = join(directory, 'ca.key');
  const cert = join(directory, 'server.pem'), key = join(directory, 'server.key');
  const csr = join(directory, 'server.csr'), extension = join(directory, 'extensions.txt');
  const caConfig = join(directory, 'ca.conf');
  await Bun.write(caConfig, '[req]\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${caKey} -out ${ca} -days 1 -subj /CN=ChangeStackTestCA -config ${caConfig}`.quiet();
  await Bun.$`openssl req -newkey rsa:2048 -nodes -keyout ${key} -out ${csr} -subj /CN=localhost`.quiet();
  await Bun.write(extension, 'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\n');
  await Bun.$`openssl x509 -req -in ${csr} -CA ${ca} -CAkey ${caKey} -CAcreateserial -out ${cert} -days 1 -extfile ${extension}`.quiet();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, tls: { cert: Bun.file(cert), key: Bun.file(key) }, fetch(request) {
    if (request.headers.get('private-token') !== 'test-token') return new Response(null, { status: 401 });
    if (new URL(request.url).pathname.endsWith('/diffs')) return Response.json([{ new_path: 'a.ts', old_path: 'a.ts', diff: '@@ -1 +1 @@\n-old();\n+new();\n' }]);
    return Response.json({ title: 'TLS test', description: '', author: { username: 'test' }, source_branch: 'feature', target_branch: 'main', diff_refs: { head_sha: 'head', base_sha: 'base', start_sha: 'base' } });
  } });
  const origin = `https://localhost:${server.port}`;
  const config = join(directory, 'config.json');
  await Bun.write(config, JSON.stringify({ version: 1, hosts: { [origin]: { provider: 'gitlab', baseUrl: origin, token: 'test-token' } }, aiSetupSkipped: true }));
  const run = (env: Record<string, string | undefined>, targetOrigin = origin) => Bun.spawn([binary, `${targetOrigin}/team/repo/-/merge_requests/1`, '--no-ai', '--no-open', '--port', '0'], {
    cwd: directory, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CHANGE_STACK_CONFIG: config, CHANGE_STACK_CA_FILE: undefined, NODE_EXTRA_CA_CERTS: undefined, ...env },
  });
  for (const env of [{}, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }]) {
    const child = run(env); const timer = setTimeout(() => child.kill(), 15_000);
    try { if (await child.exited !== 1) throw new Error('Binary accepted an untrusted certificate.'); }
    finally { clearTimeout(timer); child.kill(); }
  }
  const child = run({ CHANGE_STACK_CA_FILE: ca }); const timer = setTimeout(() => child.kill(), 15_000);
  try {
    const reader = child.stdout.getReader(); let output = '', launch: string | undefined;
    while (!launch) {
      const { value, done } = await reader.read(); if (done) throw new Error('Binary failed with the trusted company CA.');
      output += new TextDecoder().decode(value); launch = output.match(/http:\/\/127\.0\.0\.1:\d+\/#session=[a-f0-9-]+/)?.[0];
    }
    const url = new URL(launch), auth = await fetch(`${url.origin}/api/session`, { method: 'POST', headers: { Origin: url.origin, Authorization: `Bearer ${url.hash.slice(9)}` } });
    const cookie = auth.headers.get('set-cookie')!.split(';')[0];
    const result = await (await fetch(`${url.origin}/api/review`, { headers: { Cookie: cookie } })).json();
    if (result.review.files.length !== 1 || result.review.title !== 'TLS test') throw new Error('Trusted TLS review did not load.');
  } finally { clearTimeout(timer); child.kill(); await child.exited; }
  console.log('Compiled binary TLS passed: corporate CA works; untrusted certificates are rejected even with TLS bypass environment set.');
} finally { server?.stop(true); await rm(directory, { recursive: true, force: true }); }
