# Vendored dependency: marked

`marked.umd.js` in this directory is a verbatim, unmodified copy of the marked
markdown parser. It is vendored rather than fetched at runtime so that a
rendered plan is a single self-contained file that opens with no network access.

| | |
|---|---|
| Version | 16.4.2 |
| Source | `https://cdn.jsdelivr.net/npm/marked@16/lib/marked.umd.js` |
| Bytes | 41042 |
| SHA-256 | `2e20e86f0a13107ae9bf00675894bbb573716a8e5b4fde612eacaff1e404c128` |
| License | MIT |

The UMD build is the one that matters here: it assigns a global `marked`, which
is what `assets/template-head.html` calls. The unversioned
`cdn.jsdelivr.net/npm/marked/marked.min.js` path is ambiguous — it 404s under an
explicit `@16` but resolves under `latest` — so the pin above is deliberate.

To update, replace the file and refresh all four rows:

```sh
curl -sSL -o plan-it/assets/marked.umd.js \
  "https://cdn.jsdelivr.net/npm/marked@<VERSION>/lib/marked.umd.js"
wc -c plan-it/assets/marked.umd.js
shasum -a 256 plan-it/assets/marked.umd.js
sh plan-it/test/render-test.sh
```

---

## License information

Reproduced from the marked package's `LICENSE.md`.

### Contribution License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

### Marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

### Markdown

Copyright © 2004, John Gruber
http://daringfireball.net/
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
* Neither the name “Markdown” nor the names of its contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

This software is provided by the copyright holders and contributors “as is” and
any express or implied warranties, including, but not limited to, the implied
warranties of merchantability and fitness for a particular purpose are
disclaimed. In no event shall the copyright owner or contributors be liable for
any direct, indirect, incidental, special, exemplary, or consequential damages
(including, but not limited to, procurement of substitute goods or services;
loss of use, data, or profits; or business interruption) however caused and on
any theory of liability, whether in contract, strict liability, or tort
(including negligence or otherwise) arising in any way out of the use of this
software, even if advised of the possibility of such damage.
