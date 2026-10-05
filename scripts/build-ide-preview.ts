import { copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const version = '0.2.2';
const output = resolve(`dist/ide-preview-v${version}`);
await mkdir(output, { recursive: true });
const plugin = `change-stack-intellij-${version}.zip`;
await copyFile(`ide-plugin/build/distributions/${plugin}`, join(output, plugin));
await Bun.write(join(output, 'INSTALL.md'), (await Bun.file('docs/intellij-gitlab-install.md').text()).replace('(../ide-plugin/VALIDATION.md)', '(VALIDATION.md)'));
await copyFile('ide-plugin/VALIDATION.md', join(output, 'VALIDATION.md'));
await copyFile('dist/THIRD_PARTY_NOTICES.txt', join(output, 'THIRD_PARTY_NOTICES.txt'));

const files = [plugin, 'INSTALL.md', 'VALIDATION.md', 'THIRD_PARTY_NOTICES.txt'];
await Bun.write(join(output, 'SHA256SUMS'), (await Promise.all(files.map(async file =>
  `${createHash('sha256').update(new Uint8Array(await Bun.file(join(output, file)).arrayBuffer())).digest('hex')}  ${file}`))).join('\n') + '\n');
const child = Bun.spawn(['tar', '-czf', resolve(`dist/change-stack-gitlab-preview-v${version}.tar.gz`), '-C', resolve('dist'), `ide-preview-v${version}`], { stdout: 'inherit', stderr: 'inherit' });
if (await child.exited) throw new Error('Preview archive failed.');
console.log(`Prepared ${output}. Both Mac analyzers are inside the plugin ZIP. No release was published.`);
