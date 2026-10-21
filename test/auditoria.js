// Auditoria de cobertura: mede se o Radar está deixando escapar alguma menção à UNCISAL.
// Não altera nada do site: só roda o site/analyzer.js e confere o resultado.
//
//   node test/auditoria.js            → audita as fixtures (test/fixtures)
//   node test/auditoria.js --doe 20   → baixa as últimas 20 edições do site do DOE e audita
//                                        (PDFs ficam em cache na pasta temporária do sistema, fora do repositório)
//
// Três números:
//  1. Cobertura dos sinais: toda menção com sinal de UNCISAL (nome, processo 41010, unidade) tem de cair num ato
//     ou num trecho ignorado de propósito (lista de dirigentes, cabeçalho de seção). O que sobrar "escapou".
//  2. Suspeitos: coisas parecidas com UNCISAL fora de qualquer ato, pra alguém conferir no olho.
//  3. Gabarito: se existir test/gabarito/<número da edição>.json (atos marcados na mão pela PROGESP),
//     mede quantos o Radar achou. Formato: [{ "pagina": 4, "busca": "E:41010.0000014317/2025" }, ...]
//     "busca" é um pedaço de texto que identifica o ato (processo, nome, número da portaria).
const fs = require('fs'), path = require('path'), os = require('os');
const A = require('../site/analyzer.js');

// Mesmos sinais que o site/analyzer.js usa (se mudar lá, mude aqui; a checagem de consistência abaixo avisa)
const SINAL = /UNCISAL|Universidade Estadual de Ci[eê]ncias da Sa[uú]de|\b4101(?:0\s?\.\s?\d{4,10}|0?-\d{3,6})\/\d{2,4}|H[eé]lvio Auto|Matern\w*\.?\s+Esc\w*\.?\s+Santa M[oô]nica|Hosp\w*\.?\s+Esc\w*\.?\s+Portugal Ramalho/gi;
// Rede larga: pega variações e pedaços que os sinais não pegam
const LARGA = /U\s?N\s?C\s?I\s?-?\s?S\s?A\s?L|Ci[eê]ncias da Sa[uú]de de Alagoas|\b41010\b|H[eé]lvio Auto|Santa M[oô]nica|Portugal Ramalho|Reitora? da Universidade Estadual de Ci/gi;
const DIRIGENTES = /[A-Z]{3,} - (UNIVERSIDADE|INSTITUTO|AG[EÊ]NCIA|JUNTA|FUNDA[CÇ][AÃ]O|COMPANHIA)/g;
const conta = (re, s) => (s.match(re) || []).length;
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');

function auditar(nome, files) {
  const r = A.analyze(files);
  const ed = r.editions.map(e => e.numero ? `${e.numero}${e.suplemento ? ' Supl.' : ''}` : e.arquivo).join(' + ');
  const iso = r.editions.map(e => e.iso).filter(Boolean).sort().pop() || '';
  const out = { nome, ed, data: iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '', atos: r.acts.length, sinais: 0, emAto: 0, dirigentes: 0, cabecalho: 0, escaparam: [], suspeitos: [], inconsistente: 0 };
  for (const s of r.segmentos) {
    const n = conta(SINAL, s.texto);
    if (s.unc && !n) out.inconsistente++;               // ato marcado sem sinal: os sinais daqui e do analyzer divergiram
    if (n) {
      out.sinais += n;
      if (s.unc) out.emAto += n;
      else if (conta(DIRIGENTES, s.texto) >= 3) out.dirigentes += n;
      else if (s.texto.replace(SINAL, '').replace(/Universidade Estadual de Ci[eê]ncias da Sa[uú]de de Alagoas|\(UNCISAL\)|[^A-Za-zÀ-ú]/gi, '').length < 60) out.cabecalho += n;
      else out.escaparam.push({ pagina: s.pagina, trecho: s.texto.slice(0, 160) });
    } else if (!s.unc) {
      for (const m of s.texto.matchAll(LARGA)) out.suspeitos.push({ pagina: s.pagina, trecho: s.texto.slice(Math.max(0, m.index - 70), m.index + 90) });
    }
  }
  // gabarito da PROGESP, se houver
  const nums = [...new Set(r.editions.map(e => e.numero).filter(Boolean))];
  const gab = nums.map(n => path.join(__dirname, 'gabarito', `${n}.json`)).find(f => fs.existsSync(f));
  if (gab) {
    const itens = JSON.parse(fs.readFileSync(gab, 'utf8'));
    const atos = r.acts.map(a => ({ p: a.pagina, t: fold(a.titulo + ' ' + a.trecho + ' ' + a.foco) }));
    out.gabarito = { total: itens.length, achados: 0, faltaram: [] };
    for (const it of itens) {
      const b = fold(String(it.busca || ''));
      const ok = atos.some(a => (!it.pagina || Math.abs(a.p - it.pagina) <= 1) && (!b || a.t.includes(b)));
      if (ok) out.gabarito.achados++; else out.gabarito.faltaram.push(it);
    }
  }
  return out;
}

// --- fontes: fixtures ou edições baixadas do DOE
const API = 'https://diario.imprensaoficial.al.gov.br/apinova/api';
async function pdfPages(file) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    pages.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
  }
  await pdf.destroy();
  return pages;
}
// o servidor do DOE às vezes fecha a conexão no meio: tenta de novo, com uma pausa, e só grava o arquivo completo
async function baixar(url, tentativas = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer()), total = +res.headers.get('content-length');
      if (total && buf.length !== total) throw new Error(`veio ${buf.length} de ${total} bytes`);
      await new Promise(r => setTimeout(r, 500));
      return buf;
    } catch (err) {
      if (i >= tentativas) throw err;
      process.stderr.write(`  falhou (${err.message}); tentando de novo…\n`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}
async function diasDoDoe(n) {
  const t = new Date(); let y = t.getFullYear(), m = t.getMonth() + 1; const dias = [];
  for (let i = 0; dias.length < n && i < 12; i++) {
    const j = await (await fetch(`${API}/editions/published/${y}/${m}`)).json();
    const by = new Map();
    for (const e of j.editions || []) { const d = String(e.publication_date).slice(0, 10); if (!by.has(d)) by.set(d, []); by.get(d).push(e); }
    dias.push(...[...by].sort((a, b) => b[0].localeCompare(a[0])).map(([d, eds]) => ({ d, eds: eds.sort((a, b) => a.suplement - b.suplement) })));
    if (--m === 0) { m = 12; y--; }
  }
  return dias.slice(0, n);
}
async function fontes(args) {
  const i = args.indexOf('--doe');
  if (i < 0) {
    const dir = path.join(__dirname, 'fixtures');
    // edição e suplemento do mesmo dia juntos, como o site faz
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    return files.map(f => ({ nome: f.name, files: [f] }));
  }
  const n = +args[i + 1] || 10, cache = path.join(os.tmpdir(), 'radar-auditoria');
  fs.mkdirSync(cache, { recursive: true });
  const out = [];
  for (const dia of await diasDoDoe(n)) {
    const files = [];
    for (const e of dia.eds) {
      const f = path.join(cache, `${e.id}.pdf`);
      if (!fs.existsSync(f)) {
        process.stderr.write(`baixando DOE nº ${e.number}${e.suplement ? ' supl.' : ''} (${dia.d})…\n`);
        fs.writeFileSync(f, await baixar(`${API}/editions/viewPdf/${e.id}`));
      }
      files.push({ name: `${e.id}.pdf`, id: e.id, pages: await pdfPages(f) });
    }
    out.push({ nome: dia.d, files });
  }
  return out;
}

(async () => {
  const lista = await fontes(process.argv.slice(2));
  const res = lista.map(x => auditar(x.nome, x.files));
  const pct = (a, b) => b ? (100 * a / b).toFixed(1).replace('.', ',') + '%' : '—';
  console.log('\nEdição                    Atos  Sinais  Em ato  Dirig.  Cabeç.  Escaparam  Suspeitos');
  for (const o of res) console.log(`${(o.ed + (o.data ? ' · ' + o.data : '')).padEnd(25).slice(0, 25)} ${String(o.atos).padStart(4)}  ${String(o.sinais).padStart(6)}  ${String(o.emAto).padStart(6)}  ${String(o.dirigentes).padStart(6)}  ${String(o.cabecalho).padStart(6)}  ${String(o.escaparam.length).padStart(9)}  ${String(o.suspeitos.length).padStart(9)}`);
  const T = k => res.reduce((a, o) => a + (Array.isArray(o[k]) ? o[k].length : o[k]), 0);
  const sinais = T('sinais'), escap = res.reduce((a, o) => a + o.escaparam.length, 0);
  console.log(`\n1. Cobertura dos sinais: ${pct(sinais - escap, sinais)} (${sinais - escap} de ${sinais} menções em ${res.length} edições)`);
  console.log(`   ${T('emAto')} viraram ato · ${T('dirigentes')} na lista de dirigentes · ${T('cabecalho')} cabeçalho de seção · ${escap} escaparam`);
  res.forEach(o => o.escaparam.forEach(x => console.log(`   ESCAPOU ${o.ed} p.${x.pagina}: ${x.trecho}`)));
  const susp = res.flatMap(o => o.suspeitos.map(x => ({ ...x, ed: o.ed })));
  console.log(`\n2. Suspeitos pra conferir no olho: ${susp.length}`);
  susp.slice(0, 15).forEach(x => console.log(`   ${x.ed} p.${x.pagina}: …${x.trecho.replace(/\s+/g, ' ')}…`));
  if (susp.length > 15) console.log(`   … e mais ${susp.length - 15}`);
  const comGab = res.filter(o => o.gabarito);
  if (comGab.length) {
    const tot = comGab.reduce((a, o) => a + o.gabarito.total, 0), ach = comGab.reduce((a, o) => a + o.gabarito.achados, 0);
    console.log(`\n3. Acerto contra o gabarito da PROGESP: ${pct(ach, tot)} (${ach} de ${tot} atos, em ${comGab.length} edições)`);
    comGab.forEach(o => o.gabarito.faltaram.forEach(it => console.log(`   FALTOU ${o.ed} p.${it.pagina || '?'}: ${it.busca}`)));
  } else {
    console.log(`\n3. Acerto contra o gabarito: sem gabarito ainda. Crie test/gabarito/<número da edição>.json com os atos da UNCISAL marcados na mão.`);
  }
  const inc = T('inconsistente');
  if (inc) console.log(`\nATENÇÃO: ${inc} ato(s) da UNCISAL sem nenhum sinal desta auditoria. Os sinais daqui e do site/analyzer.js divergiram.`);
})().catch(e => { console.error(e); process.exit(1); });
