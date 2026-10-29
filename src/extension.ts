import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import texmath from 'markdown-it-texmath';
import hljs from 'highlight.js';

const VIEW_TYPE = 'jupyterMdPreview';

let md: MarkdownIt;
let panel: vscode.WebviewPanel | undefined;
let currentNotebook: vscode.NotebookDocument | undefined;
let output: vscode.OutputChannel;
let updateTimer: ReturnType<typeof setTimeout> | undefined;
let pendingScrollCell: number | undefined;
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  output = vscode.window.createOutputChannel('Jupyter Markdown Live Preview');

  md = new MarkdownIt({
    html: true,
    linkify: true,
    highlight(code: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch {
          /* ignore */
        }
      }
      return '';
    },
  });
  md.use(texmath, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: { output: 'html', throwOnError: false, strict: false },
  });

  log('Extension aktiviert.');

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('jupyterMdPreview.open', openPreview),
    vscode.workspace.onDidChangeNotebookDocument(onNotebookChanged),
    vscode.window.onDidChangeActiveNotebookEditor(onActiveEditorChanged),
    vscode.workspace.onDidCloseNotebookDocument(onNotebookClosed)
  );
}

export function deactivate(): void {
  if (updateTimer) {
    clearTimeout(updateTimer);
  }
}

function log(message: string): void {
  output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

function openPreview(): void {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) {
    const open = vscode.workspace.notebookDocuments;
    if (open.length === 0) {
      vscode.window.showErrorMessage(
        'Öffne zuerst ein Notebook, dann die Markdown-Live-Vorschau.'
      );
      return;
    }
    currentNotebook = open[0];
  } else {
    currentNotebook = editor.notebook;
  }

  log(`Vorschau angefordert für: ${currentNotebook?.uri.toString()}`);

  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    renderNow();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    'Markdown-Live-Vorschau',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(
          path.join(extensionContext.extensionPath, 'node_modules', 'katex', 'dist')
        ),
      ],
    }
  );

  panel.webview.onDidReceiveMessage((msg) => {
    if (msg && msg.type === 'error') {
      log(`WEBVIEW-FEHLER: ${msg.message} (${msg.source}:${msg.line})`);
      vscode.window.showErrorMessage(
        `Vorschau-Fehler: ${msg.message} (siehe Ausgabe-Panel)`
      );
    }
  });

  panel.webview.html = getWebviewHtml(extensionContext, panel.webview, buildBodyHtml());

  panel.onDidDispose(
    () => {
      log('Panel geschlossen.');
      panel = undefined;
      currentNotebook = undefined;
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = undefined;
      }
    },
    undefined,
    []
  );

  renderNow();
}

function buildBodyHtml(): string {
  if (!currentNotebook) {
    return '<p class="empty">Kein Notebook geöffnet.</p>';
  }
  const cells = renderMarkdownCells(currentNotebook);
  log(
    `Rendere ${currentNotebook.getCells().length} Zellen, Markdown-HTML: ${cells.length} Zeichen.`
  );
  if (cells.length === 0) {
    return '<p class="empty">Dieses Notebook enthält keine Markdown-Zellen.<br>Schreibe z.&nbsp;B. <code># Überschrift</code> in eine Markdown-Zelle – sie erscheint hier sofort.</p>';
  }
  return cells;
}

function onNotebookChanged(event: vscode.NotebookDocumentChangeEvent): void {
  if (!panel || event.notebook !== currentNotebook) {
    return;
  }

  for (const cellChange of event.cellChanges) {
    if (cellChange.document) {
      pendingScrollCell = cellChange.cell.index;
      log(`Änderung in Zelle ${cellChange.cell.index} erkannt.`);
    }
  }
  scheduleUpdate();
}

function onActiveEditorChanged(
  editor: vscode.NotebookEditor | undefined
): void {
  if (!panel || !editor) {
    return;
  }
  const follow = vscode.workspace
    .getConfiguration('jupyterMdPreview')
    .get<boolean>('followActiveNotebook', true);
  if (!follow) {
    return;
  }
  if (editor.notebook !== currentNotebook) {
    currentNotebook = editor.notebook;
    pendingScrollCell = undefined;
    log(`Aktives Notebook: ${currentNotebook.uri.toString()}`);
    renderNow();
  }
}

function onNotebookClosed(notebook: vscode.NotebookDocument): void {
  if (notebook === currentNotebook) {
    currentNotebook = undefined;
  }
}

function scheduleUpdate(): void {
  if (updateTimer) {
    clearTimeout(updateTimer);
  }
  const delay = vscode.workspace
    .getConfiguration('jupyterMdPreview')
    .get<number>('updateDelay', 250);
  updateTimer = setTimeout(() => {
    updateTimer = undefined;
    renderNow();
  }, delay);
}

function renderNow(): void {
  if (!panel) {
    return;
  }
  const bodyHtml = buildBodyHtml();
  const scrollCell = pendingScrollCell;
  pendingScrollCell = undefined;

  panel.title = currentNotebook
    ? `Vorschau: ${fileName(currentNotebook)}`
    : 'Markdown-Live-Vorschau';

  void panel.webview.postMessage({ type: 'update', html: bodyHtml, scrollCell });
}

function renderMarkdownCells(notebook: vscode.NotebookDocument): string {
  const parts: string[] = [];
  for (const cell of notebook.getCells()) {
    if (cell.kind !== vscode.NotebookCellKind.Markup) {
      continue;
    }
    const source = cell.document.getText();
    parts.push(
      `<section class="cell" id="cell-${cell.index}">${md.render(source)}</section>`
    );
  }
  return parts.join('\n');
}

function fileName(notebook: vscode.NotebookDocument): string {
  const idx = notebook.uri.path.lastIndexOf('/');
  return idx >= 0 ? notebook.uri.path.slice(idx + 1) : notebook.uri.path;
}

function getWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  initialBodyHtml: string
): string {
  const nonce = getNonce();
  const katexDist = vscode.Uri.file(
    path.join(context.extensionPath, 'node_modules', 'katex', 'dist')
  );
  const fontBase = webview
    .asWebviewUri(katexDist)
    .toString()
    .replace(/[\\$]/g, '\\$&');

  const katexCss = readCss(
    path.join(katexDist.fsPath, 'katex.min.css')
  ).replaceAll('url(fonts/', `url(${fontBase}/fonts/`);

  const dark =
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
  const hljsCss = readCss(
    path.join(
      context.extensionPath,
      'node_modules',
      'highlight.js',
      'styles',
      dark ? 'github-dark.css' : 'github.css'
    )
  );

  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} https: data:`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown-Live-Vorschau</title>
  <style>${katexCss}</style>
  <style>${hljsCss}</style>
  <style>
    body {
      margin: 0;
      padding: 8px 20px 64px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      word-wrap: break-word;
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.25;
      margin: 1.2em 0 0.6em 0;
      font-weight: 600;
    }
    h1 { font-size: 2em; border-bottom: 1px solid rgba(128,128,128,0.35); padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid rgba(128,128,128,0.25); padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1em; }
    h5 { font-size: 0.875em; }
    h6 { font-size: 0.85em; opacity: 0.85; }
    p { margin: 0.8em 0; }
    a { color: var(--vscode-textLink-foreground); }
    code {
      font-family: var(--vscode-editor-font-family, Menlo, Consolas, monospace);
      font-size: 0.9em;
      background: rgba(128,128,128,0.15);
      padding: 0.2em 0.4em;
      border-radius: 4px;
    }
    pre {
      background: rgba(128,128,128,0.12);
      padding: 12px 14px;
      border-radius: 6px;
      overflow-x: auto;
      line-height: 1.45;
    }
    pre code {
      background: none;
      padding: 0;
      font-size: 0.9em;
    }
    blockquote {
      margin: 0.8em 0;
      padding: 0 1em;
      border-left: 4px solid rgba(128,128,128,0.4);
      opacity: 0.9;
    }
    table {
      border-collapse: collapse;
      margin: 0.8em 0;
    }
    th, td {
      border: 1px solid rgba(128,128,128,0.4);
      padding: 6px 12px;
    }
    th { background: rgba(128,128,128,0.12); }
    img { max-width: 100%; }
    hr {
      border: none;
      border-top: 1px solid rgba(128,128,128,0.35);
      margin: 1.5em 0;
    }
    ul, ol { padding-left: 1.6em; }
    li { margin: 0.25em 0; }
    input[type="checkbox"] { margin-right: 0.4em; }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      margin-top: 2em;
    }
  </style>
</head>
<body>
  <div id="content">${initialBodyHtml}</div>
  <script nonce="${nonce}">
    (function () {
      var vscode = acquireVsCodeApi();
      var content = document.getElementById('content');

      window.onerror = function (message, source, line) {
        try {
          vscode.postMessage({ type: 'error', message: String(message), source: String(source), line: line });
        } catch (e) { /* ignore */ }
        return false;
      };

      window.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg || msg.type !== 'update') {
          return;
        }
        var scrollY = window.scrollY;
        content.innerHTML = msg.html;

        if (typeof msg.scrollCell === 'number' && msg.scrollCell >= 0) {
          var el = document.getElementById('cell-' + msg.scrollCell);
          if (el) {
            el.scrollIntoView({ block: 'start' });
          }
        } else {
          window.scrollTo(0, scrollY);
        }
      });
    })();
  </script>
</body>
</html>`;
}

function readCss(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    log(`CSS konnte nicht gelesen werden: ${filePath} – ${e}`);
    return '';
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
