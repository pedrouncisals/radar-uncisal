// Testa o site/analyzer.js contra as fixtures (texto das amostras do DOE, com CPF zerado).
// node test/run.js          → roda as verificações
// node test/run.js --show   → também imprime o que o Radar marca em cada edição
const fs = require('fs'), path = require('path');
const A = require('../site/analyzer.js');

const FIX = path.join(__dirname, 'fixtures');
const load = f => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const ED = {
  e2905: 'DOEAL5192800290516102026_signed.json',
  sup2905: 'SUP5192900290516102026_signed.json',
  e2906: 'DOEAL5193000290619102026_signed.json',
};
const R = Object.fromEntries(Object.entries(ED).map(([k, f]) => [k, A.analyze([load(f)])]));

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) { fails++; console.log('FALHOU', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } else console.log('ok    ', msg); };
const find = (r, re) => r.acts.find(a => re.test(a.trecho + ' ' + a.foco + ' ' + a.titulo));
const short = a => a && { sev: a.sev, tags: a.tags, grupo: a.grupo, p: a.pagina, t: a.titulo };

// --- 0. CPF nunca aparece sem máscara
// 3.3.3 solto (sem número colado antes ou depois) ou 11 dígitos seguidos; CNPJ e códigos tipo 10.121.106.5063 ficam de fora
const CPF_SHAPE = /(^|[^\d.])\d{3}\s?\.\s?\d{3}\s?\.\s?\d{3}(?![\d.])|(^|\D)\d{11}(?!\d)/;
[
  '240.316.234 -53', '131.305.185\n-52', '001.017.794- 96', 'CPF nº059.196.354-01', 'CPF 05919635401', 'CPF: 059 196 354 01', '073.106.344 -9 6',
].forEach(raw => check(!/\d{3}.?\d{3}/.test(A.maskCpf(raw.replace(/\s+/g, ' '))), `máscara pega "${raw.replace('\n', '\\n')}"`, A.maskCpf(raw)));
check(A.maskCpf('Processo E:41010.0000014317/2025, CNPJ 33.891.594/0001-27, R$ 115.200,00') === 'Processo E:41010.0000014317/2025, CNPJ 33.891.594/0001-27, R$ 115.200,00', 'máscara não come processo, CNPJ e valor');
for (const [k, r] of Object.entries(R)) {
  const strings = [...r.acts.flatMap(a => [a.titulo, a.trecho, a.foco]), ...r.estado.flags.map(f => f.trecho), ...r.segmentos.map(s => s.texto)];
  const clean = s => s.replace(/\d{1,3}(\.\d{3}){2,},\d{2}/g, '').replace(/Inscri[cç][aã]o Estadual:?\s*[\d.\-\s]+/gi, ''); // valores em R$ e inscrição estadual
  const leak = strings.map(clean).find(s => CPF_SHAPE.test(s));
  check(!leak, `${k}: nenhum CPF exposto em atos, alertas do Estado ou busca`, leak && leak.slice(Math.max(0, leak.search(CPF_SHAPE) - 60), leak.search(CPF_SHAPE) + 40));
}

// --- 1. Precisão: o que deveria e o que não deveria marcar
const r5 = R.e2905, r6 = R.e2906;
let a;
a = find(r5, /Policl[ií]nica IB GATTO FALC[AÃ]O/i);
check(a && a.sev === 'rotina' && a.grupo === 'Contratos e obras', '2905 p.39: obra da Policlínica UNCISAL é rotina / Contratos e obras', short(a));
a = find(r5, /Prorroga[cç][aã]o Contratual/);
check(a && a.sev === 'rotina', '2905 p.7: despacho PGE de prorrogação contratual é rotina', short(a));
a = find(r5, /RECONHECIMENTO DE D[IÍ]VIDA/i);
check(a && a.sev === 'atencao' && a.tags.includes('Dívida reconhecida'), '2905 p.50: dívida de exercício anterior continua atenção', short(a));
a = find(r5, /926107-88\/2026/);
check(a && a.sev === 'atencao' && a.tags.includes('Compra emergencial') && /Descart/i.test(a.objeto), '2905 p.50: compra emergencial continua atenção, objeto "Descartáveis"', short(a) && { ...short(a), objeto: a.objeto });
a = find(r5, /AMANDA KAROL/);
check(a && a.sev === 'atencao' && a.tags.includes('Nomeação'), '2905 p.7: nomeação definitiva por decisão judicial é atenção / Nomeação', short(a));

a = find(r6, /E:41010\.0000014317\/2025/);
check(a && a.grupo === 'Aposentadoria e pensão', '2906 p.4: aposentadoria (processo 41010, sem o nome UNCISAL) é achada', short(a));
a = find(r6, /E:41010\.0000013594\/2026/);
check(a && a.grupo === 'Aposentadoria e pensão', '2906: segunda aposentadoria via processo 41010 é achada', short(a));
a = find(r6, /E:41010\.0000002387\/2026/);
check(a && a.sev === 'atencao' && a.tags.includes('Remuneração / vantagens') && /^Pessoal: Adicional/.test(a.titulo), '2906 p.5: indeferimento de adicional (VPNI) é atenção, com título do processo', short(a));
a = find(r6, /926107- ?89\/2026/);
check(a && a.sev === 'atencao' && /[aá]gua mineral/i.test(a.objeto), '2906 p.65: compra emergencial de água mineral é atenção', short(a) && { ...short(a), objeto: a.objeto });
a = find(r6, /PORTARIA\/UNCISAL Nº 3666/);
check(a && a.grupo === 'Lotação e movimentação', '2906 p.78: portaria de lotação vai pro grupo Lotação', short(a));
check(r6.estado.exon === 7 && r6.estado.exonOrg[0][0] === 'UNEAL' && r6.estado.anuladas === 0, '2906: Estado com 7 exonerações (UNEAL) e 0 anuladas', r6.estado);
check(R.sup2905.acts.length === 0, 'suplemento 2905: nada da UNCISAL', R.sup2905.counts);

for (const [k, r] of Object.entries(R)) {
  const bad = r.acts.filter(x => !/^[A-ZÀ-Ú(“"]/.test(x.titulo) && !/^Pessoal|^Contratos|^Comunica/.test(x.titulo));
  check(bad.length === 0, `${k}: todo ato começa no cabeçalho (sem título cortado no meio)`, bad.map(x => x.titulo.slice(0, 50)));
  const keys = r.acts.map(x => x.edicao + x.pagina + x.foco.slice(-120));
  check(new Set(keys).size === keys.length, `${k}: sem ato repetido`);
}

// --- Busca
let s = A.search(r6, 'maria laura dantas');
check(s && s.uncisal.length === 1 && s.uncisal[0].pagina === 4, 'busca por nome sem acento acha a servidora da UNCISAL', s && s.uncisal.map(x => x.pagina));
s = A.search(r6, '0500407');
check(s && s.uncisal.length >= 1, 'busca por matrícula sem o dígito e sem hífen acha "0500407-1"', s && s.total);
s = A.search(r6, 'ODILON MÁXIMO');
check(s && s.outros.length >= 1, 'busca separa o que é de outros órgãos', s && { u: s.uncisal.length, o: s.outros.length });
check(A.search(r6, 'ab') === null && A.search(r6, '123') === null, 'busca ignora termo curto');

// --- Relatório
if (process.argv.includes('--show')) {
  for (const [k, r] of Object.entries(R)) {
    const e = r.editions[0];
    console.log(`\n==== ${k} · nº ${e.numero}${e.suplemento ? ' Supl.' : ''} · ${e.data} · ${e.paginas} p.`);
    console.log('counts', JSON.stringify(r.counts), '| rotina', JSON.stringify(r.rotinaGrupos));
    console.log(`Estado: exon ${r.estado.exon}, anuladas ${r.estado.anuladas}, nomeações ${r.estado.nomeacoes}; ${JSON.stringify(r.estado.exonOrg)}`);
    r.acts.forEach(x => console.log(`  ${x.sev.padEnd(7)} p.${String(x.pagina).padEnd(3)} ${x.grupo.padEnd(24)} {${x.tags.join(', ')}}${x.objeto ? ' [' + x.objeto + ']' : ''}\n          ${x.titulo.slice(0, 110)}`));
  }
}
console.log(fails ? `\n${fails} verificação(ões) falharam` : '\nTudo certo');
process.exit(fails ? 1 : 0);
