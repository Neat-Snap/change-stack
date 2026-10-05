import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

const targets = [['macos-arm64', 'bun-darwin-arm64'], ['macos-x64', 'bun-darwin-x64'], ['linux-x64', 'bun-linux-x64']] as const;
const output = resolve('ide-plugin/build/generated-resources/analyzers');
const run = async (args: string[]) => {
  const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) throw new Error('Analyzer build failed.');
};
await run([process.execPath, 'run', 'styles']);
for (const [directory, target] of targets) {
  await mkdir(`${output}/${directory}`, { recursive: true });
  await run([process.execPath, 'build', '--compile', `--target=${target}`,
    '--define', 'CHANGE_STACK_BUILD_VERSION="0.2.2-gitlab-preview"', 'src/cli.ts', '--outfile', `${output}/${directory}/cstack`]);
  await chmod(`${output}/${directory}/cstack`, 0o755);
}
await run([process.execPath, 'run', 'notices']);
await Bun.write('ide-plugin/build/generated-resources/THIRD_PARTY_NOTICES.txt', await Bun.file('dist/THIRD_PARTY_NOTICES.txt').text());
