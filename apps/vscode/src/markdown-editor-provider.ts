import { saveImageRequest } from "@wysidown/core";
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { EditorConnection } from "./editor-connection.ts";
import { savePastedImage } from "./images.ts";
import { folderOf, linkedAddress, linkedFile, remoteImages, resourcesOf, type Folder } from "./resources.ts";

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

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const webview = panel.webview;
    const media = vscode.Uri.joinPath(this.#extensionUri, "dist", "webview");
    const folder = await folderOf(document.uri);
    // Images load from the document's repository, or its folder outside one, and nowhere else on disk.
    const show = () => {
      webview.options = { enableScripts: true, localResourceRoots: folder ? [media, folder.root] : [media] };
      webview.html = page(webview, media, remoteImages());
    };
    show();
    const connection = new EditorConnection(document, (message) => {
      void webview.postMessage(
        message.type === "load" ? { ...message, resources: resourcesOf(webview, folder) } : message,
      );
      if (message.type === "load") this.#loaded.fire(document);
    });
    const subscription = webview.onDidReceiveMessage((message: unknown) => {
      const image = saveImageRequest(message);
      if (image) {
        return savePasted(document, folder, image.data).then((path) =>
          webview.postMessage({ type: "imageSaved", id: image.id, path }),
        );
      }
      const address = linkedAddress(message);
      if (address) return vscode.env.openExternal(address);
      const linked = linkedFile(message, folder);
      return linked ? openLinked(linked) : connection.receive(message);
    });
    // The page is shown again under a CSP that allows images from the web only while they are on.
    const configuring = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("wysidown.remoteImages")) show();
    });
    // A save waits for the editor's edits to be applied. A hidden webview cannot answer a flush, but
    // edits it sent before it was hidden may still be waiting.
    const saving = vscode.workspace.onWillSaveTextDocument((event) => {
      if (event.document === document) event.waitUntil(panel.visible ? connection.flush() : connection.idle());
    });
    panel.onDidDispose(() => {
      subscription.dispose();
      configuring.dispose();
      saving.dispose();
      connection.dispose();
    });
  }
}

/**
 * Saves a pasted image beside `document`, in `folder`, and returns its path relative to the
 * document; null when it was not saved, after telling the user why.
 */
async function savePasted(document: vscode.TextDocument, folder: Folder | null, data: string): Promise<string | null> {
  if (!folder) {
    void vscode.window.showWarningMessage(
      document.isUntitled
        ? "Save the document before pasting images: Wysidown saves them in an images folder beside it."
        : "Wysidown saves pasted images only beside a document on this computer.",
    );
    return null;
  }
  try {
    return await savePastedImage(folder.dir, Buffer.from(data, "base64"));
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Wysidown cannot paste the image. ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Opens the markdown file a link in a document leads to in Wysidown, or says it is not there. */
async function openLinked(uri: vscode.Uri): Promise<void> {
  const found = await vscode.workspace.fs.stat(uri).then(
    () => true,
    () => false,
  );
  if (!found) {
    void vscode.window.showErrorMessage(`Wysidown cannot find ${uri.fsPath}.`);
    return;
  }
  await vscode.commands.executeCommand("vscode.openWith", uri, MarkdownEditorProvider.viewType);
}

/**
 * The webview's page: the editor bundle and its stylesheet, under a CSP that allows nothing else to
 * run, and images only from the webview's resources, `data:` and, when `remote`, the web.
 */
function page(webview: vscode.Webview, media: vscode.Uri, remote: boolean): string {
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
      content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${source}; img-src ${source} data:${remote ? " https:" : ""}; font-src ${source}"
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
