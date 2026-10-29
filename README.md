# Jupyter Markdown Live Preview

VS Code Extension, die die Markdown-Zellen eines Jupyter Notebooks **live** rendert –
während du tippst, ohne dass du erst `Strg+Enter` drücken oder die Zelle verlassen musst.

## Features

- Live-Vorschau aller Markdown-Zellen in einem Webview-Panel neben dem Notebook
- Aktualisiert sich automatisch beim Tippen (entprellt, standardmäßig 250 ms)
- Automatischer Scroll zur Zelle, die du gerade bearbeitest
- KaTeX-Formeln (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`)
- Syntax-Highlighting für Code-Blöcke (highlight.js)
- Tabellen, Aufgabenlisten, Blockquotes etc. via markdown-it
- Folgt standardmäßig dem aktiven Notebook (abschaltbar)

## Nutzung

1. Notebook öffnen
2. Befehl `Markdown-Live-Vorschau öffnen` ausführen (oder das Buch-Symbol in der Notebook-Titelleiste)
3. Markdown-Zellen bearbeiten – die Vorschau aktualisiert sich sofort

## Einstellungen

| Einstellung | Standard | Beschreibung |
|---|---|---|
| `jupyterMdPreview.followActiveNotebook` | `true` | Vorschau wechselt automatisch zum aktiven Notebook |
| `jupyterMdPreview.updateDelay` | `250` | Entprell-Verzögerung in ms |

## Entwicklung

```bash
npm install
npm run watch     # Build mit Watch-Modus
npm run typecheck # Typprüfung
npm run package   # .vsix bauen (vsce)
```

Debuggen: `F5` startet eine Extension Development Host Instanz.
