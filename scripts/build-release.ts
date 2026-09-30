import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import packageInfo from '../package.json';

const version = process.env.CHANGE_STACK_RELEASE_VERSION ?? `v${packageInfo.version}`;
if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Expected a version tag such as v0.1.0.');
const directory = join('dist', `cstack-${version}-macos-x64`);
await mkdir(directory, { recursive: true });
const binary = join(directory, 'cstack');
const child = Bun.spawn([process.execPath, 'build', '--compile', '--target=bun-darwin-x64', '--define', `CHANGE_STACK_BUILD_VERSION=${JSON.stringify(version.slice(1))}`, 'src/cli.ts', '--outfile', binary], { stdout: 'inherit', stderr: 'inherit' });
if (await child.exited) throw new Error('macOS binary build failed.');
const notices = Bun.spawn([process.execPath, 'run', 'notices'], { stdout: 'inherit', stderr: 'inherit' });
if (await notices.exited) throw new Error('License notice generation failed.');
for (const name of ['README.md', 'README.ru.md', 'dist/THIRD_PARTY_NOTICES.txt']) await copyFile(name, join(directory, name.split('/').at(-1)!));
if (process.platform === 'darwin') {
  const probe = Bun.spawn([binary, '--version'], { stdout: 'pipe', stderr: 'inherit' });
  const actual = (await new Response(probe.stdout).text()).trim();
  if (await probe.exited || actual !== version.slice(1)) throw new Error('Native Intel macOS binary check failed.');
}
const archive = `${directory}.tar.gz`;
const tar = Bun.spawn(['tar', '-czf', archive, '-C', 'dist', directory.split('/').at(-1)!], { stdout: 'inherit', stderr: 'inherit' });
if (await tar.exited) throw new Error('Release archive creation failed.');
const digest = createHash('sha256').update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest('hex');
await Bun.write('dist/SHA256SUMS', `${digest}  ${archive.split('/').at(-1)}\n`);
console.log(`Prepared ${archive} and dist/SHA256SUMS. No tag or release was created.`);
