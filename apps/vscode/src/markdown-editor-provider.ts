import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { EditorConnection } from "./editor-connection.ts";

/** Shows a markdown `TextDocument` in the Wysidown editor, in a webview. */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = "wysidown.markdown";
  readonly #extensionUri: vscode.Uri;
  readonly #loaded = new vscode.EventEmitter<vscode.TextDocument>();
  /** Fires when an editor's webview has asked for its document and been sent it. */
  readonly onDidLoad = this.#loaded.event;

  constructor(extensionUri: vscode.Uri) {
    this.#extensionUri = extensionUri;
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    const media = vscode.Uri.joinPath(this.#extensionUri, "dist", "webview");
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    webview.html = page(webview, media);
    const connection = new EditorConnection(document, (message) => {
      void webview.postMessage(message);
      if (message.type === "load") this.#loaded.fire(document);
    });
    const subscription = webview.onDidReceiveMessage((message: unknown) => connection.receive(message));
    panel.onDidDispose(() => {
      subscription.dispose();
      connection.dispose();
    });
  }
}

/** The webview's page: the editor bundle and its stylesheet, under a CSP that allows nothing else to run. */
function page(webview: vscode.Webview, media: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64");
  const source = webview.cspSource;
  const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.js")).toString();
  const style = webview.asWebviewUri(vscode.Uri.joinPath(media, "editor.css")).toString();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${source}; img-src ${source} https: data:; font-src ${source}"
    />
    <link rel="stylesheet" href="${style}" />
    <title>Wysidown</title>
  </head>
  <body>
    <div id="editor"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>
`;
}
