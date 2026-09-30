# Diffshub UI comparison

Reference: https://diffshub.com/oven-sh/bun/pull/30412

Inspected in the shared T3 browser on 2026-09-30. Firecrawl scraping was unavailable because its account had no credits, so the browser was used for inspection.

## Observations

- The page reports 2,188 files and 1,132,444 lines. At the inspected scroll position, only three `diffs-container` elements were mounted, with about 1,000 nodes across their shadow roots. That is evidence of windowed rendering; it is not a latency benchmark or a claim about their implementation source.
- The diff pane is a continuous surface: file headers and code sit together rather than inside separate rounded cards with large outer gaps.
- The inspected code uses 13px text and 20px line height. Our previous settings were 12px and 24px, with additional 20px gaps between file cards.
- The toolbar puts appearance and display controls behind small icons. It leaves most of the width for the current review.
- File headers remain close to their code. The file tree shows many compact rows, with extension icons and optional search/filter controls.

## Changes made here

- Use Pierre's React `Virtualizer` around the existing patch components. It renders code near the viewport with a 600px overscan region, while keeping file headers and complete file navigation available. We still keep a header/container for every file; this is not full file-level virtualization like the reference appears to use.
- Flatten the file list into one pane and remove repeated rounded outer frames and large inter-file gaps.
- Use 13px code with 20px line height, matching Pierre's default virtualization metrics.
- Make file jumps immediate instead of animating a potentially long journey through the diff list.
- Keep the current file header sticky while scrolling its code.
- Use compact, accessible icons for theme and split/unified controls.
- Preserve the requested summary boxes, Reviewed checkboxes, theme options, and independently collapsible Layers and Files sections.

The likely benefit is less DOM work while scrolling and fewer competing visual surfaces. Exact performance parity with Diffshub has not been measured. A browser smoke check exercises a 6,000-line patch, checks that fewer than 500 line nodes are mounted, and jumps to a following file without filtering the list.

Useful future additions are an optional file search and keyboard navigation between files. Full file-level virtualization and moving syntax highlighting to local workers would need separate validation for very large reviews.
