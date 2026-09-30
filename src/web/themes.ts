import { registerCustomTheme } from '@pierre/diffs';

export const themes = {
  'github-dark': 'GitHub dark', 'github-light': 'GitHub light',
  'gitlab-dark': 'GitLab dark', 'gitlab-light': 'GitLab light',
} as const;
export type ReviewTheme = keyof typeof themes;

// Local Shiki themes with GitLab's neutral UI and syntax palette. No runtime downloads.
for (const dark of [false, true]) {
  const name = dark ? 'gitlab-dark' : 'gitlab-light';
  registerCustomTheme(name, async () => ({
    name, type: dark ? 'dark' : 'light',
    colors: { 'editor.background': dark ? '#1f1e24' : '#ffffff', 'editor.foreground': dark ? '#ececef' : '#333238',
      'diffEditor.insertedTextBackground': dark ? '#173d2b' : '#ddfbe6',
      'diffEditor.removedTextBackground': dark ? '#572b30' : '#fdd4cd' },
    tokenColors: [
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: dark ? '#89888d' : '#737278' } },
      { scope: ['keyword', 'storage'], settings: { foreground: dark ? '#f97583' : '#a626a4' } },
      { scope: ['string'], settings: { foreground: dark ? '#a8cc8c' : '#50a14f' } },
      { scope: ['constant.numeric', 'constant.language'], settings: { foreground: dark ? '#d19a66' : '#986801' } },
      { scope: ['entity.name.function'], settings: { foreground: dark ? '#82aaff' : '#4078f2' } },
      { scope: ['entity.name.type', 'support.type'], settings: { foreground: dark ? '#e5c07b' : '#c18401' } },
      { scope: ['variable', 'entity.name.tag'], settings: { foreground: dark ? '#ececef' : '#333238' } },
    ],
  }));
}
