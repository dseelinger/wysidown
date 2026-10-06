import { builtinModules } from "node:module";
import ts from "typescript";

const builtins = new Set(builtinModules);

/** True for a module specifier that only a host may import. */
export function isHostModule(specifier: string): boolean {
  const base = specifier.split("/")[0]!;
  return (
    specifier.startsWith("node:") ||
    builtins.has(specifier) ||
    builtins.has(base) ||
    specifier === "node" ||
    base === "vscode" ||
    base === "electron" ||
    specifier === "@types/node" ||
    specifier === "@types/vscode"
  );
}

/** Every module a source file refers to: imports, re-exports, import types, dynamic imports, requires and type references. */
export function moduleReferences(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = source.typeReferenceDirectives.map((d) => d.fileName);
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.push(node.moduleReference.expression.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg = node.arguments[0];
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if ((isImport || isRequire) && arg && ts.isStringLiteralLike(arg)) found.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The host modules a source file refers to. */
export function hostImports(fileName: string, text: string): string[] {
  return moduleReferences(fileName, text).filter(isHostModule);
}
