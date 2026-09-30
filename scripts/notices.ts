import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const sections: string[] = ['Third-party notices for Change Stack Local\n'];
async function packages(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const path = join(directory, item.name);
    if (item.name.startsWith('@')) paths.push(...(await readdir(path)).map(name => join(path, name)));
    else paths.push(path);
  }
  return paths;
}
for (const path of await packages('node_modules')) {
  const packageFile = Bun.file(join(path, 'package.json'));
  if (!await packageFile.exists()) continue;
  const pkg = await packageFile.json();
  const files = (await readdir(path)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
  sections.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? 'See package documentation'}\n`);
  for (const name of files) sections.push(`${name}\n${await Bun.file(join(path, name)).text()}`);
}
sections.push('\nBun runtime licenses: https://bun.com/docs/project/licensing\n');
await Bun.write('dist/THIRD_PARTY_NOTICES.txt', sections.join('\n'));
console.log('Wrote dist/THIRD_PARTY_NOTICES.txt');
