// Gera as fixtures: extrai o texto por página dos PDFs do DOE (igual ao readPdf do site/index.html)
// e zera os dígitos de tudo que parece CPF, mantendo a formatação, pra o teste da máscara continuar valendo.
// Uso: node test/extract.js amostras [outro.pdf ...]
const fs = require('fs'), path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const CPF_LIKE = /(^|\D)(\d{3}[\s.]*\d{3}[\s.]*\d{3}[\s-]*\d\s*\d)(?!\d)/g;
const zeroCpf = s => s.replace(CPF_LIKE, (_, pre, cpf) => pre + cpf.replace(/\d/g, '0'));

async function pdfPages(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    pages.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
  }
  return pages;
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('Uso: node test/extract.js <pasta-ou-pdf> ...'); process.exit(1); }
  const files = args.flatMap(a => fs.statSync(a).isDirectory()
    ? fs.readdirSync(a).filter(f => /\.pdf$/i.test(f)).map(f => path.join(a, f)) : [a]);
  const out = path.join(__dirname, 'fixtures');
  fs.mkdirSync(out, { recursive: true });
  for (const f of files) {
    const name = path.basename(f);
    const pages = (await pdfPages(f)).map(zeroCpf);
    fs.writeFileSync(path.join(out, name.replace(/\.pdf$/i, '.json')), JSON.stringify({ name, pages }));
    console.log(`${name}: ${pages.length} páginas`);
  }
})();
