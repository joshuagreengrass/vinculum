// Renderizador de Markdown pensado para prosa de fanfic. Sin dependencias.
//
// Soporta: párrafos, saltos de línea simples (se respetan), # títulos,
// **negrita**, *cursiva* / _cursiva_, ***ambas***, ~~tachado~~,
// > citas, separadores de escena (*** · * * * · ---), listas con "* " o "1. ",
// ![imagen](ruta), [enlace](url).
// Los diálogos que empiezan con "-" se convierten a raya (—).

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(src) {
  let s = escapeHtml(src);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*(?=\S)(.+?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_(?=\S)(.+?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/(^|\s)--(?=\s|$)/g, '$1—');
  s = s.replace(/\n/g, '<br>');
  return s;
}

const RE = {
  heading: /^(#{1,6})\s+(.*)$/,
  hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
  quote: /^\s*>\s?(.*)$/,
  ul: /^\s*[*+]\s+(.*)$/,
  ol: /^\s*\d+[.)]\s+(.*)$/,
  dialog: /^(\s*)-(?!-)\s*/,
};

export function renderMarkdown(md, { dropFirstH1 = true } = {}) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let i = 0;

  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join('\n'))}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { flush(); i++; continue; }

    if (RE.hr.test(line)) { flush(); out.push('<hr>'); i++; continue; }

    const h = line.match(RE.heading);
    if (h) {
      flush();
      const level = h[1].length;
      if (!(level === 1 && dropFirstH1 && out.length === 0)) {
        out.push(`<h${Math.max(level, 2)}>${inline(h[2])}</h${Math.max(level, 2)}>`);
      }
      i++; continue;
    }

    if (RE.quote.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].match(RE.quote)[1]);
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), { dropFirstH1: false })}</blockquote>`);
      continue;
    }

    const listType = RE.ul.test(line) ? 'ul' : RE.ol.test(line) ? 'ol' : null;
    if (listType) {
      flush();
      const items = [];
      while (i < lines.length && RE[listType].test(lines[i])) items.push(lines[i++].match(RE[listType])[1]);
      out.push(`<${listType}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${listType}>`);
      continue;
    }

    para.push(line.replace(RE.dialog, '$1—').replace(/^\s+/, ''));
    i++;
  }
  flush();
  return out.join('\n');
}

export function countWords(md) {
  return (md.replace(/[#>*_`~\-\[\]()!]/g, ' ').match(/\S+/g) || []).length;
}
