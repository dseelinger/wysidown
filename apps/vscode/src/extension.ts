import * as vscode from "vscode";
import { MarkdownEditorProvider } from "./markdown-editor-provider.ts";

/** What the extension returns from activation. */
export interface WysidownApi {
  /** Fires when a Wysidown editor has been sent its document. */
  readonly onDidLoad: vscode.Event<vscode.TextDocument>;
}

/** Called by VS Code on activation. Registers the Wysidown editor for markdown files. */
export function activate(context: vscode.ExtensionContext): WysidownApi {
  const provider = new MarkdownEditorProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, provider));
  return { onDidLoad: provider.onDidLoad };
}
