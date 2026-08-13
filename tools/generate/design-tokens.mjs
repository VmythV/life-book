import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const sourcePath = resolve(root, 'docs/design-system.md');
const outputPath = resolve(root, 'packages/ui/src/generated/design-tokens.generated.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startHeading, endHeading) {
  const start = source.indexOf(startHeading);
  const end = source.indexOf(endHeading, start + startHeading.length);

  if (start < 0 || end < 0) {
    throw new Error(`Cannot locate design token section ${startHeading}.`);
  }

  return source.slice(start, end);
}

function markdownRows(section) {
  return section
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll('`', '')),
    );
}

function parseColors() {
  const coreColors = markdownRows(
    sectionBetween('### DS-020：核心语义颜色', '### DS-021：状态颜色'),
  ).map(([token, light, dark]) => {
    if (token === undefined || light === undefined || dark === undefined) {
      throw new Error('Malformed DS-020 token row.');
    }
    return [token, { light, dark }];
  });

  const statusColors = markdownRows(
    sectionBetween('### DS-021：状态颜色', '### DS-022：交互颜色规则'),
  )
    .filter(([token]) => token?.startsWith('state.') === true)
    .flatMap(([token, lightPair, darkPair]) => {
      if (token === undefined || lightPair === undefined || darkPair === undefined) {
        throw new Error('Malformed DS-021 token row.');
      }

      const [lightForeground, lightContainer] = lightPair.split(' / ');
      const [darkForeground, darkContainer] = darkPair.split(' / ');
      if (
        lightForeground === undefined ||
        lightContainer === undefined ||
        darkForeground === undefined ||
        darkContainer === undefined
      ) {
        throw new Error(`Malformed status color pair for ${token}.`);
      }

      return [
        [`color.${token}.foreground`, { light: lightForeground, dark: darkForeground }],
        [`color.${token}.container`, { light: lightContainer, dark: darkContainer }],
      ];
    });

  return [...coreColors, ...statusColors];
}

function parseTypography() {
  return markdownRows(
    sectionBetween('### DS-031：文本样式', '### DS-032：数字与数量'),
  ).map(([token, sizeAndLineHeight, weight]) => {
    if (token === undefined || sizeAndLineHeight === undefined || weight === undefined) {
      throw new Error('Malformed DS-031 token row.');
    }

    const match = /^(\d+) \/ (\d+)$/u.exec(sizeAndLineHeight);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      throw new Error(`Malformed typography dimensions for ${token}.`);
    }

    return [
      token,
      {
        fontSize: Number.parseInt(match[1], 10),
        fontWeight: weight,
        lineHeight: Number.parseInt(match[2], 10),
      },
    ];
  });
}

function parseNumericTokens(startHeading, endHeading) {
  return markdownRows(sectionBetween(startHeading, endHeading)).map(([token, value]) => {
    if (token === undefined || value === undefined || !/^\d+$/u.test(value)) {
      throw new Error(`Malformed numeric design token row in ${startHeading}.`);
    }
    return [token, Number.parseInt(value, 10)];
  });
}

function emitObject(name, entries) {
  const lines = entries.map(
    ([token, value]) => `  ${JSON.stringify(token)}: ${JSON.stringify(value)},`,
  );
  return `export const ${name} = {\n${lines.join('\n')}\n} as const;`;
}

const generated = [
  '// @generated',
  '// Source: docs/design-system.md (DS-020, DS-021, DS-031, DS-040, DS-042)',
  '// Generator: tools/generate/design-tokens.mjs',
  '// Do not edit by hand.',
  '',
  emitObject('DESIGN_COLOR_TOKENS', parseColors()),
  '',
  emitObject('DESIGN_TYPE_TOKENS', parseTypography()),
  '',
  emitObject(
    'DESIGN_SPACE_TOKENS',
    parseNumericTokens('### DS-040：间距比例', '### DS-041：命中尺寸和控件高度'),
  ),
  '',
  emitObject(
    'DESIGN_RADIUS_TOKENS',
    parseNumericTokens('### DS-042：圆角', '### DS-043：边界与阴影'),
  ),
  '',
].join('\n');

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== generated) {
    console.error('Generated design tokens are stale. Run `pnpm generate`.');
    process.exit(1);
  }
  console.log('Generated design tokens are current.');
} else {
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, generated);
  console.log('Generated packages/ui/src/generated/design-tokens.generated.ts.');
}
