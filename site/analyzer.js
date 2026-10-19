// Radar UNCISAL — motor de análise do DOE/AL. Recebe o texto por página, devolve o relatório.
// Fonte única: o site carrega este arquivo e o test/run.js também (via require).
(function (root) {
  // A UNCISAL aparece pelo nome, pelo código de órgão dos processos (E:41010.… / 4101-…) ou por uma das unidades
  const UNC_NAME = /UNCISAL|Universidade Estadual de Ci[eê]ncias da Sa[uú]de/i;
  const UNC = /UNCISAL|Universidade Estadual de Ci[eê]ncias da Sa[uú]de|\b4101(?:0\s?\.\s?\d{4,10}|-\d{3,6})\/\d{2,4}|H[eé]lvio Auto|Matern\w*\.?\s+Esc\w*\.?\s+Santa M[oô]nica|Hosp\w*\.?\s+Esc\w*\.?\s+Portugal Ramalho/i;
  // CPF com ou sem pontuação, inclusive com espaço antes do dígito ("240.316.234 -53") ou quebrado na linha
  const maskCpf = s => s.replace(/(^|\D)(\d{3}\s?\.?\s?\d{3}\s?\.?\s?\d{3}\s?-?\s?\d\s?\d)(?!\d)/g, '$1•••');
  const norm = s => s.replace(/\s+/g, ' ').replace(/Oicial/g, 'Oficial').replace(/Certiicada/g, 'Certificada').trim();
  const stripHeader = s => s
    .replace(/Edi[cç][aã]o Eletr[oô]nica Certificada Digitalmente conforme LEI N[°º] ?7\.397\/2012/g, ' ')
    .replace(/Di[aá]rio Oficial Estado de Alagoas/g, ' ')
    .replace(/Poder Executivo(?: SUPLEMENTO)?(?= Macei)/g, ' ')
    .replace(/Ano \d+ - N[uú]mero \d+(?:\s*\.)*/g, ' ')
    .replace(/Macei[oó] - (?:(?:segunda|ter[cç]a|quarta|quinta|sexta)-feira|s[aá]bado|domingo) \d{1,2} de [a-zç]+ de \d{4}( \d{1,3})?/gi, ' ')
    .replace(/\s+/g, ' ');

  const CONTRATO = /TERMO DE CONTRATO|TERMO ADITIVO|OBJETO CONTRATUAL|CONTRATAD[AO]:|Contratos e Conv[eê]nios|Prorroga[cç][aã]o Contratual|execu[cç][aã]o da obra/i;

  // Regras: [severidade, rótulo, regex, regex extra que precisa bater junto, regex que não pode bater]
  const RULES = [
    ['alerta', 'Contenção de despesas', /conten[cç][aã]o de (despesas?|gastos)|redu[cç][aã]o de (despesas?|gastos)|contingenciamento|limita[cç][aã]o de empenho/i],
    ['alerta', 'Repasse / programação financeira', /programa[cç][aã]o financeira|Fundo Estadual de Sa[uú]de|descentraliza[cç][aã]o (de|dos) recursos/i, null, /EXTRATO|TERMO DE CONTRATO|OBJETO CONTRATUAL|ATA DE REGISTRO/i],
    ['atencao', 'Dívida reconhecida', /reconhecimento de d[ií]vida|exerc[ií]cio anterior/i],
    // Contrato e obra são rotina; só sobem se forem rescindidos, suspensos ou mudarem de valor
    ['atencao', 'Contrato: rescisão, suspensão ou valor', /rescis|suspens|acr[eé]scimo|supress[aã]o|reequil[ií]brio|repactua|aditivo[^.]{0,80}valor/i, CONTRATO],
    ['alerta', 'Corte de prestadores', /prestador(es|a)? de servi[cç]os?/i, /redu[cç]|corte|deslig|rescis|suspens|encerr|dispens/i],
    ['alerta', 'Rescisão / desligamento', /rescis|distrato|desligament/i, /pessoal|prestador|servidor|contrato administrativo|v[ií]nculo/i],
    ['alerta', 'Exoneração', /exonera(r|[cç][aã]o)/i, null, /a pedido|ad nutum|livre nomea[cç][aã]o e exonera/i],
    ['atencao', 'Exoneração a pedido', /exonera(r|[cç][aã]o)[^.]{0,40}a pedido|a pedido[^.]{0,60}exonera/i],
    ['atencao', 'Mudança na gestão', /(Reitor|Vice-Reitor|Pr[oó]-Reitor|Chefe de Gabinete)[^.]{0,60}UNCISAL|UNCISAL[^.]{0,80}(Reitor|Pr[oó]-Reitor)/i, /nomea|exonera|designa/i],
    ['atencao', 'Nomeação', /RESOLVE,? ?nomear|para exercer o cargo|nomea[cç][aã]o de?f?initiva|nomea[cç][aã]o[^.]{0,200}decis[aã]o judicial|decis[aã]o judicial[^.]{0,200}nomea/i],
    ['atencao', 'Remuneração / vantagens', /VPNI|regime remunerat[oó]rio de subs[ií]dio|complemento constitucional|redu[cç][aã]o remunerat|teto constitucional|(indeferi\w*|n[aã]o[- ]acolhimento)[^.]{0,200}(adicional|gratifica[cç][aã]o|vantage|progress[aã]o|insalubridade|periculosidade)|(adicional|gratifica[cç][aã]o|vantage|progress[aã]o)[^.]{0,120}indeferi/i],
    ['atencao', 'Ato anulado', /tornar sem efeito|revogar o Decreto/i],
    ['atencao', 'Prestadores de serviço', /prestador(es|a)? de servi[cç]os?/i],
    ['atencao', 'Carga horária', /carga hor[aá]ria/i, /redu|indefer|readequa|amplia/i],
    ['atencao', 'Restrição orçamentária', /disponibilidade or[cç]ament[aá]ria|previs[aã]o or[cç]ament[aá]ria|escassez de recursos|impacto financeiro|compensa[cç][aã]o (de despesa|or[cç]ament)/i],
    ['atencao', 'Compra emergencial', /emergencia/i],
    ['atencao', 'Crédito orçamentário', /cr[eé]dito (suplementar|especial|extraordin)/i],
    ['atencao', 'MP / TAC', /Termo de Ajustamento|Promotoria de Justi[cç]a/i],
    ['atencao', 'Cita seu setor', /PROGESP|SUPLAF|SUMOF|Gest[aã]o de Pessoas/i],
  ];
  const ROTINA = [
    ['Férias', /f[eé]rias/i],
    ['Progressão', /progress[aã]o/i],
    ['Aposentadoria e pensão', /aposentadoria|\bpens[aã]o|abono de perman/i],
    ['Lotação e movimentação', /\blotar\b|\blota[cç][aã]o\b|remo[cç][aã]o|redistribui|cess[aã]o de servidor/i],
    ['Licenças e afastamentos', /licen[cç]a|afastamento|aux[ií]lio por incapacidade/i],
    ['Contratos e obras', CONTRATO],
    ['Compras e atas', /EXTRATO|ata de registro|registro de pre[cç]os|preg[aã]o|aquisi[cç][aã]o|dispensa eletr|contrata[cç][aã]o direta|licita/i],
    ['Adicionais', /insalubridade|periculosidade|adicional/i],
    ['Diárias', /\bdi[aá]rias?\b/i],
    ['Retificação', /retifica|retiica/i],
    ['Parecer da PGE', /PGE|Procuradoria/i],
    ['Portarias da Reitoria', /PORTARIA\s*\/?\s*UNCISAL/i],
  ];

  // Despacho da PGE: "PROCESSO E:… INTERESSADO … ASSUNTO … DESPACHO". O assunto diz o tipo do ato melhor que o texto todo.
  const PGE_HEAD = /^P?ROCESSO\s*E?:?\s?([\d.\-\/]+)\s+INTERESSADO\s+(.{2,120}?)\s+ASSUNTO\s+(.{2,140}?)\s+(?:DESPACHO|PARECER)/;

  function classify(text, assunto) {
    const tags = [];
    let sev = 'rotina';
    for (const [s, label, re, must, not] of RULES) {
      if (!re.test(text)) continue;
      if (must && !must.test(text)) continue;
      if (not && not.test(text)) continue;
      tags.push(label);
      if (s === 'alerta') sev = 'alerta';
      else if (s === 'atencao' && sev === 'rotina') sev = 'atencao';
    }
    let group = 'Outros';
    for (const t of assunto ? [assunto, text] : [text]) {
      const g = ROTINA.find(([, re]) => re.test(t));
      if (g) { group = g[0]; break; }
    }
    return { sev, tags, group };
  }

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function isoDate(d) {
    const m = d.match(/(\d{1,2}) de ([a-zç]+) de (\d{4})/i);
    const k = m ? MESES.indexOf(m[2].toLowerCase().replace('marco', 'março')) : -1;
    return k < 0 ? '' : `${m[3]}-${String(k + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  function editionMeta(first) {
    const n = (first.match(/N[uú]mero\s+(\d{3,5})/) || [])[1] || '';
    const d = (first.match(/(segunda|ter[cç]a|quarta|quinta|sexta)-feira\s+(\d{1,2} de [a-zç]+ de \d{4})|(s[aá]bado|domingo)\s+(\d{1,2} de [a-zç]+ de \d{4})/i) || []);
    const date = d[2] || d[4] || '';
    const sup = /Suplemento/i.test(first.slice(0, 600));
    return { numero: n, data: date, iso: isoDate(date), suplemento: sup };
  }

  const ORG_RE = /(?:da|do) ((?:Secretaria|Controladoria|Procuradoria|Gabinete|Universidade|Ag[eê]ncia|Alagoas Previd|Funda[cç][aã]o|Instituto|Pol[ií]cia|Defensoria|Companhia|Corpo de Bombeiros|Vice-Governadoria|Junta|Arquivo|Imprensa|Superintend)[^,]{0,90}?)(?:, do Servi[cç]o|\.|,|$)/i;
  function orgName(w) {
    if (/Livre Lota[cç][aã]o/i.test(w)) return 'SEGOV · Livre Lotação';
    const m = w.match(ORG_RE);
    if (!m) return 'Órgão não identificado';
    let o = m[1].replace(/\s+-\s+/g, ' - ').trim();
    const sig = o.match(/-\s*([A-Z]{2,}[A-Z/]*)\s*$/) || o.match(/\b([A-Z]{3,}[A-Z/]*)\s*$/);
    return sig ? sig[1] : o.slice(0, 60);
  }

  // Ato longo: guarda o começo (título, processo, interessado) e a janela em volta da menção à UNCISAL
  const MAX = 2600;
  function cut(text, k) {
    if (text.length <= MAX || k < 1500) return text.slice(0, MAX);
    return text.slice(0, 500) + ' […] ' + text.slice(Math.max(500, k - 1000), k + 1100);
  }
  // Objeto de uma compra: "aquisição EMERGENCIAL de Descartáveis" → "Descartáveis"
  function objeto(text) {
    const m = text.match(/(?:aquisi[cç][aã]o|contrata[cç][aã]o)\s+(?:EMERGENCIAL\s+)?(?:de|da|do|dos|das)\s+([^,.;]{3,90})/i);
    return m ? m[1].replace(/,? com crit[eé]rio.*$/i, '').trim() : '';
  }

  function analyze(files) {
    // files: [{name, pages: [string], id?}]  (id = id da edição na API do DOE, quando veio de lá)
    const editions = [];
    const acts = [];
    const segmentos = [];
    const estado = { exon: 0, exonOrg: {}, anuladas: 0, nomeacoes: 0, signers: {}, flags: [] };
    for (const f of files) {
      const rawPages = f.pages.map(norm);
      const meta = editionMeta(rawPages[0] || '');
      // CPF mascarado já na página: tudo que sai daqui (atos, trechos, busca) vem do texto mascarado
      const pages = rawPages.map(p => maskCpf(stripHeader(p)));
      meta.paginas = pages.length; meta.arquivo = f.name;
      if (f.id) meta.id = f.id;
      editions.push(meta);
      const edLabel = meta.numero ? `${meta.numero}${meta.suplemento ? ' Supl.' : ''}` : f.name;
      // texto corrido com mapa de página
      let full = ''; const starts = [];
      pages.forEach(p => { starts.push(full.length); full += p + ' '; });
      const pageAt = i => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= i) lo = mid; else hi = mid - 1; } return lo + 1; };

      // Estado: exonerações por órgão
      for (const m of full.matchAll(/RESOLVE,?\s+(?:conceder\s+)?exonera(?:r|[cç][aã]o)/g)) {
        const w = full.slice(m.index, m.index + 650);
        estado.exon++;
        const o = orgName(w); estado.exonOrg[o] = (estado.exonOrg[o] || 0) + 1;
      }
      estado.anuladas += (full.match(/tornar sem efeito o Decreto[\s\S]{0,160}?que exonerou/gi) || []).length;
      estado.nomeacoes += (full.match(/RESOLVE,?\s+nomear/g) || []).length;
      for (const m of full.matchAll(/([A-ZÀ-Ú]{3,}(?:\s+(?:D[AEO]S?|[A-ZÀ-Ú]{2,}))+)\s+(Governador(?:a)?(?:\s+em\s+exerc[ií]cio)?\b|Presidente d[oa] [^,]{5,70}, no exerc[ií]cio do cargo de Governador)/g)) {
        const k = m[1].trim() + (/exerc/.test(m[2]) ? ' (interino)' : '');
        estado.signers[k] = (estado.signers[k] || 0) + 1;
      }
      for (const m of full.matchAll(/conten[cç][aã]o de (despesas?|gastos)|redu[cç][aã]o de (despesas?|gastos)|contingenciamento|limita[cç][aã]o de empenho/gi)) {
        const w = full.slice(Math.max(0, m.index - 220), m.index + 220);
        estado.flags.push({ edicao: edLabel, pagina: pageAt(m.index), trecho: w });
      }

      // Atos: separa por "Protocolo NNNN" e depois por cabeçalhos de ato
      const chunks = [];
      let last = 0;
      for (const m of full.matchAll(/Protocolo\s+\d{5,8}/g)) { chunks.push([last, m.index + m[0].length]); last = m.index + m[0].length; }
      chunks.push([last, full.length]);
      const HEAD = /(?=DECRETO N[º°o]\s*[\d.]+, DE \d{1,2} DE [A-ZÇ]+ DE \d{4}\.?\s(?:O GOVERNADOR|DECRETO|O PRESIDENTE)|PORTARIA\s*\/?\s*[A-Z]*\s*N[º°o.]|EXTRATO\b|AVISO DE|PROCESSO\s*(?:N[º°o.]*\s*)?E?:?\s?\d{4,5}[.\-]\d|PROC\.\s?E?:?\s?\d|TERMO DE|RESOLU[CÇ][AÃ]O\b|LEI N[º°o]\s*[\d.]+)/g;
      for (const [a, b] of chunks) {
        // "nos termos da PORTARIA PGE N.º 327/2022, conheço…" é citação, não começo de ato: cola no pedaço anterior
        const parts = full.slice(a, b).split(HEAD).reduce((acc, p) => {
          if (acc.length && /^PORTARIA[^,]{0,40}?N[º°o.]+\s*[\d.\/]+\s*(?:\[\d+\])?,/.test(p)) acc[acc.length - 1] += p;
          else acc.push(p);
          return acc;
        }, []);
        let off = a;
        for (const p of parts) {
          const pStart = off; off += p.length;
          const seg = { edicao: edLabel, pagina: pageAt(pStart), unc: false, texto: p.trim() };
          if (seg.texto.length > 20) segmentos.push(seg);
          if (!UNC.test(p)) continue;
          // lista padrão de dirigentes da administração indireta: ignora
          if ((p.match(/[A-Z]{3,} - (UNIVERSIDADE|INSTITUTO|AG[EÊ]NCIA|JUNTA|FUNDA[CÇ][AÃ]O|COMPANHIA)/g) || []).length >= 3) continue;
          const whole = p.trim();
          if (whole.replace(UNC, '').replace(/Universidade Estadual de Ci[eê]ncias da Sa[uú]de de Alagoas|\(UNCISAL\)|[^A-Za-zÀ-ú]/gi, '').length < 60) continue;
          const text = cut(whole, whole.search(UNC));
          const pge = text.match(PGE_HEAD);
          const c = classify(text, pge && pge[3]);
          const k = text.search(UNC);
          seg.unc = true;
          acts.push({
            edicao: edLabel, pagina: pageAt(pStart + Math.max(0, p.search(UNC))),
            sev: c.sev, tags: c.tags, grupo: c.group,
            titulo: pge ? `${pge[3]} · ${pge[2]} · Proc. ${pge[1]}` : text.slice(0, 110),
            trecho: text.slice(0, 900),
            foco: text.slice(Math.max(0, k - 160), k + 260),
            objeto: c.tags.includes('Compra emergencial') ? objeto(text) : '',
            nomeUnc: UNC_NAME.test(text),
          });
        }
      }
    }
    // remove duplicados
    const seen = new Set();
    const uniq = acts.filter(x => { const key = x.edicao + x.trecho.slice(0, 160); if (seen.has(key)) return false; seen.add(key); return true; });
    const rank = { alerta: 0, atencao: 1, rotina: 2 };
    uniq.sort((x, y) => rank[x.sev] - rank[y.sev] || x.pagina - y.pagina);
    const rotinaGrupos = {};
    uniq.filter(x => x.sev === 'rotina').forEach(x => { rotinaGrupos[x.grupo] = (rotinaGrupos[x.grupo] || 0) + 1; });
    const exonOrg = Object.entries(estado.exonOrg).sort((a, b) => b[1] - a[1]);
    return {
      editions, acts: uniq, segmentos,
      counts: { alerta: uniq.filter(x => x.sev === 'alerta').length, atencao: uniq.filter(x => x.sev === 'atencao').length, rotina: uniq.filter(x => x.sev === 'rotina').length },
      rotinaGrupos: Object.entries(rotinaGrupos).sort((a, b) => b[1] - a[1]),
      estado: { exon: estado.exon, exonOrg, anuladas: estado.anuladas, nomeacoes: estado.nomeacoes, signers: Object.entries(estado.signers).sort((a, b) => b[1] - a[1]).slice(0, 4), flags: estado.flags.slice(0, 12) },
    };
  }

  // Busca por nome ou matrícula na edição inteira. Ignora acento e caixa; em número, ignora ponto, hífen e espaço.
  const fold = s => s.replace(/[^\x00-\x7f]/g, c => c.normalize('NFD')[0]).toLowerCase();
  function search(r, q, max = 40) {
    q = (q || '').trim();
    const digits = q.replace(/\D/g, '');
    const numeric = /^[\d.\-\s\/]+$/.test(q);
    if (numeric ? digits.length < 4 : q.length < 3) return null;
    const re = numeric
      ? new RegExp(digits.split('').join('[.\\-\\s]?'), 'g')
      : new RegExp(fold(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'g');
    const out = { uncisal: [], outros: [], total: 0 };
    for (const s of r.segmentos || []) {
      if (s._f === undefined) Object.defineProperty(s, '_f', { value: fold(s.texto), enumerable: false });
      re.lastIndex = 0;
      const m = re.exec(s._f);
      if (!m) continue;
      let n = 1; while (re.exec(s._f)) n++;
      out.total += n;
      const list = s.unc ? out.uncisal : out.outros;
      if (list.length >= max) continue;
      const a = Math.max(0, m.index - 160), b = m.index + m[0].length;
      list.push({ edicao: s.edicao, pagina: s.pagina, vezes: n, antes: s.texto.slice(a, m.index), achado: s.texto.slice(m.index, b), depois: s.texto.slice(b, b + 220), inicio: a > 0 });
    }
    return out;
  }

  // Lista de vigia: cada termo vira uma busca na edição inteira. Termo com cara de CPF é recusado:
  // o texto já vem mascarado, então nunca acharia nada e pareceria "não saiu nada".
  const pareceCpf = t => /^[\d.\-\s]+$/.test(t.trim()) && t.replace(/\D/g, '').length === 11;
  function vigiar(r, termos, max = 20) {
    return termos.map(termo => {
      if (pareceCpf(termo)) return { termo, recusado: 'cpf', uncisal: [], outros: [], total: 0 };
      const s = search(r, termo, max);
      return s ? { termo, ...s } : { termo, recusado: 'curto', uncisal: [], outros: [], total: 0 };
    });
  }

  root.RadarAnalyzer = { analyze, classify, search, vigiar, pareceCpf, maskCpf, isoDate };
  if (typeof module !== 'undefined') module.exports = root.RadarAnalyzer;
})(typeof window !== 'undefined' ? window : globalThis);
