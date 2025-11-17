import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

const diagnosticCollection = vscode.languages.createDiagnosticCollection('phpmnd');
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  console.log('PHP Magic Number Detector extension is now active!');

  outputChannel = vscode.window.createOutputChannel('PHP Magic Number Detector');
  outputChannel.appendLine('PHP Magic Number Detector extension activated');
  outputChannel.appendLine(`Extension path: ${context.extensionPath}`);

  const checkCommand = vscode.commands.registerCommand(
    'php-magic-number-detector.check',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'php') {
        outputChannel.show(true);
        await checkDocument(editor.document, context.extensionPath);
      } else {
        vscode.window.showWarningMessage('Please open a PHP file to check for magic numbers.');
      }
    }
  );

  const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (document.languageId === 'php') {
      await checkDocument(document, context.extensionPath);
    }
  });

  const onOpen = vscode.workspace.onDidOpenTextDocument(async (document) => {
    if (document.languageId === 'php') {
      await checkDocument(document, context.extensionPath);
    }
  });

  if (vscode.window.activeTextEditor?.document.languageId === 'php') {
    checkDocument(vscode.window.activeTextEditor.document, context.extensionPath);
  }

  context.subscriptions.push(checkCommand, onSave, onOpen, diagnosticCollection, outputChannel);
}

async function checkDocument(document: vscode.TextDocument, extensionPath: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('phpmnd');
  const isEnabled = config.get<boolean>('enable', true);

  if (!isEnabled) {
    diagnosticCollection.set(document.uri, []);
    return;
  }

  const filePath = document.uri.fsPath;
  const fileName = path.basename(filePath);

  const timestamp = new Date().toLocaleTimeString();
  outputChannel.appendLine('');
  outputChannel.appendLine(`[${timestamp}] Starting analysis...`);
  outputChannel.appendLine(`File: ${fileName}`);
  outputChannel.appendLine(`Full path: ${filePath}`);

  try {
    const ignoreNumbers = config.get<string[]>('ignoreNumbers', []);
    const ignoreStrings = config.get<string[]>('ignoreStrings', []);
    const extensions = config.get<string>('extensions', 'all');

    const phpmndPath = path.join(extensionPath, 'phpmnd.phar');
    outputChannel.appendLine(`Using phpmnd: ${phpmndPath}`);

    let command = `php "${phpmndPath}" "${filePath}" --hint --extensions=${extensions}`;

    if (ignoreNumbers.length > 0) {
      command += ` --ignore-numbers=${ignoreNumbers.join(',')}`;
      outputChannel.appendLine(`Ignoring numbers: ${ignoreNumbers.join(', ')}`);
    }

    if (ignoreStrings.length > 0) {
      command += ` --ignore-strings=${ignoreStrings.join(',')}`;
      outputChannel.appendLine(`Ignoring strings: ${ignoreStrings.join(', ')}`);
    }

    outputChannel.appendLine(`Executing: ${command}`);

    const startTime = Date.now();

    const { stdout, stderr } = await execAsync(command, {
      cwd: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
    });

    const duration = Date.now() - startTime;
    const output = stdout + stderr;

    const diagnostics = parsePhpmndOutput(output, document);
    diagnosticCollection.set(document.uri, diagnostics);

    const endTimestamp = new Date().toLocaleTimeString();
    outputChannel.appendLine(`[${endTimestamp}] Analysis completed in ${duration}ms`);

    if (diagnostics.length === 0) {
      outputChannel.appendLine('✓ No magic numbers found');
    } else {
      outputChannel.appendLine(`✗ Found ${diagnostics.length} magic number(s):`);
      diagnostics.forEach((diag, index) => {
        outputChannel.appendLine(
          `  ${index + 1}. Line ${diag.range.start.line + 1}: ${diag.message}`
        );
      });
    }

    if (output.trim()) {
      outputChannel.appendLine('');
      outputChannel.appendLine('Raw output:');
      outputChannel.appendLine(output);
    }
  } catch (error: any) {
    if (error.stdout || error.stderr) {
      const output = error.stdout + error.stderr;
      const diagnostics = parsePhpmndOutput(output, document);
      diagnosticCollection.set(document.uri, diagnostics);

      const endTimestamp = new Date().toLocaleTimeString();
      outputChannel.appendLine(`[${endTimestamp}] Analysis completed`);

      if (diagnostics.length === 0) {
        outputChannel.appendLine('✓ No magic numbers found');
      } else {
        outputChannel.appendLine(`✗ Found ${diagnostics.length} magic number(s):`);
        diagnostics.forEach((diag, index) => {
          outputChannel.appendLine(
            `  ${index + 1}. Line ${diag.range.start.line + 1}: ${diag.message}`
          );
        });
      }

      if (output.trim()) {
        outputChannel.appendLine('');
        outputChannel.appendLine('Raw output:');
        outputChannel.appendLine(output);
      }
    } else {
      const errorTimestamp = new Date().toLocaleTimeString();
      outputChannel.appendLine(`[${errorTimestamp}] ✗ Error running phpmnd`);
      outputChannel.appendLine(`Error: ${error.message}`);

      if (error.stderr) {
        outputChannel.appendLine('stderr:');
        outputChannel.appendLine(error.stderr);
      }

      console.error('Error running phpmnd:', error);

      if (!hasShownError) {
        hasShownError = true;
        const response = await vscode.window.showErrorMessage(
          'Failed to run phpmnd. Make sure PHP is installed and available in PATH.',
          'Show Output',
          'Learn More'
        );
        if (response === 'Show Output') {
          outputChannel.show();
        } else if (response === 'Learn More') {
          vscode.env.openExternal(vscode.Uri.parse('https://github.com/povils/phpmnd'));
        }
      }

      diagnosticCollection.set(document.uri, []);
    }
  }
}

let hasShownError = false;

function parsePhpmndOutput(output: string, document: vscode.TextDocument): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const match = line.match(/^.*?:(\d+)\.\s+(.+)/);

    if (match) {
      const lineNumber = parseInt(match[1], 10) - 1;
      const message = match[2].trim();

      if (lineNumber >= 0 && lineNumber < document.lineCount) {
        const lineText = document.lineAt(lineNumber).text;

        const numberMatch = message.match(/Magic number: ([\d.]+)/);
        let range: vscode.Range;

        if (numberMatch) {
          const magicNumber = numberMatch[1];
          const index = lineText.indexOf(magicNumber);

          if (index !== -1) {
            range = new vscode.Range(lineNumber, index, lineNumber, index + magicNumber.length);
          } else {
            range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
          }
        } else {
          range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
        }

        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);

        diagnostic.source = 'phpmnd';
        diagnostics.push(diagnostic);
      }
    }
  }

  return diagnostics;
}

export function deactivate() {
  diagnosticCollection.clear();
  diagnosticCollection.dispose();
}
