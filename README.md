# IMOS Question Cutter — Standalone GitHub Edition

Updated: 6 October 2026

A standalone browser app. No AI API key, account sign-in, backend, database,
npm installation or build step is required. PDF and image processing runs on
the visitor's device. PDF.js, its worker/fonts/WASM resources, and fflate are
bundled in vendor/. Google Fonts is optional UI typography with system fallbacks.

## GitHub Pages එකට දාන විදිහ

1. ZIP එක Extract කරන්න.
2. Extract වූ සියලු files සහ folders repository එකේ root එකට upload කර commit කරන්න.
   index.html root එකේ තිබිය යුතුයි. ZIP එකම upload කිරීම ප්‍රමාණවත් නැහැ.
3. vendor folder එක සම්පූර්ණයෙන් සහ .nojekyll file එකත් ඇතුළත් කරන්න.
   Files ගණන වැඩි නිසා GitHub Desktop භාවිතයෙන් push කිරීම පහසුයි.
4. Settings → Pages → Source: Deploy from a branch තෝරන්න.
5. Branch: main (හෝ ඔබ භාවිත කරන branch එක), Folder: / (root), Save.
6. Publish වූ පසු Pages settings එකේ පෙන්වන link එක විවෘත කරන්න.

Setup guide:
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

Relative asset paths support repository subpaths and custom domains.

## Sections

- Paper Cutting: separator lines අනුව PDF questions වෙන් කිරීම.
- Tute Cutting: question numbers, units, notes සහ topics වෙන් කිරීම.
  Start page default 3; crop/type/unit අතින් නිවැරදි කළ හැක.
- Own Cutting: PDF එකේ අවශ්‍ය කොටස drag කර select කිරීම.
- Images to Board: කලින් කපාගත් PNG/JPG/WebP images එකවර upload කිරීම.
  Filename order, page preview, move up/down, remove, add more images.
  Image එකකට වෙනම page එකක් සහිත .ty file එකක් download කරන්න.

## Smart Board export

All sections support one image per page in a .ty document.
Image size slider: 10–100%, default 60% (smaller than full-board fit).
100% means fit within the board margins. Size affects display size, not PNG quality.
Default position: Between top & centre; Top and Centre are also available.
Preview and export use the same size and position.
For Images to Board, image colours and transparency stay as uploaded;
select a dark or white board background to suit the images.

.ty output follows the TYFILE1804 variant in the supplied reference file.
The structure and generated image records have been checked, but opening in
the original smart board app has not been verified here. Test a small export first.

## PNG quality and limits

Transparent white/black PNGs: default 600 DPI; 1200/300/216 DPI options.
Individual PNG and ZIP downloads, crop adjustment and splitting.
Original PNG bytes are retained during .ty export. Imported JPG/WebP images
are converted to PNG at their original pixel dimensions.

PDF uploads: up to 50 MB / 60 pages. Images to Board: up to 200 images,
50 MB per input image, and 512 MB total output images.
Automatic tute detection needs a readable PDF text layer; Own Cutting works
with scans. Review detected crops/units. Blurry scans cannot gain missing detail
by raising DPI. Use a lower DPI if a large export exceeds browser memory.

## Local use

Serve the extracted folder over HTTP; do not double-click index.html.
With Python installed, open a terminal in the extracted folder and run:

    python -m http.server 8000

Then visit http://localhost:8000/ in a current browser.

## Files

index.html, style.css, app.js, engine.mjs, tute-engine.mjs,
own-cutter.mjs, images-board.mjs, ty-export.mjs, sample PDFs and vendor/.
Keep all vendor resources and third-party licenses intact.

Source version: f51ea8c1ade3ddb5f0b970edd7d9a83773339b28
