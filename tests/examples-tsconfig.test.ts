import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

describe('examples/tsconfig.json (#574)', () => {
  it('sets ignoreDeprecations to "6.0" matching root tsconfig.json so baseUrl does not trigger TS5101', () => {
    const examplesTsconfigPath = path.resolve(__dirname, '../examples/tsconfig.json');
    const rootTsconfigPath = path.resolve(__dirname, '../tsconfig.json');

    const examplesConfig = JSON.parse(fs.readFileSync(examplesTsconfigPath, 'utf8'));
    const rootRaw = fs
      .readFileSync(rootTsconfigPath, 'utf8')
      .replace(/^\s*\/\/.*$/gm, '');
    const rootConfig = JSON.parse(rootRaw);

    expect(examplesConfig.compilerOptions.ignoreDeprecations).toBe('6.0');
    expect(examplesConfig.compilerOptions.ignoreDeprecations).toBe(
      rootConfig.compilerOptions.ignoreDeprecations,
    );

    const tscBin = path.resolve(__dirname, '../node_modules/.bin/tsc');
    const res = spawnSync(tscBin, ['-p', examplesTsconfigPath, '--noEmit'], {
      encoding: 'utf8',
    });
    const combinedOutput = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    expect(combinedOutput).not.toContain('TS5101');
  });
});
