import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Summary } from '../src/web/summary';

test('renders Markdown structure without external images, links, or raw HTML', () => {
  const html = renderToStaticMarkup(<Summary text={'**Main change**\n\n- Uses `plain words`\n- Keeps context\n\n| Before | After |\n| --- | --- |\n| Old | New |\n\n![Tracking pixel](https://other.test/pixel)\n\n[More](https://other.test)\n\n<script>alert(1)</script>'} />);
  expect(html).toContain('<strong>Main change</strong>'); expect(html).toContain('<code>plain words</code>');
  expect(html).toContain('<table>'); expect(html).toContain('<li>');
  expect(html).not.toContain('<img'); expect(html).not.toContain('href='); expect(html).not.toContain('<script');
});
