import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

// Diagnostic collection for magic numbers
const diagnosticCollection = vscode.languages.createDiagnosticCollection('phpmnd');

// Output channel for logging
let outputChannel: vscode.OutputChannel;

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log('PHP Magic Number Detector extension is now active!');

  // Create output channel
  outputChannel = vscode.window.createOutputChannel('PHP Magic Number Detector');
  outputChannel.appendLine('PHP Magic Number Detector extension activated');
  outputChannel.appendLine(`Extension path: ${context.extensionPath}`);

  // Register command to manually check current file
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

  // Check on save
  const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (document.languageId === 'php') {
      await checkDocument(document, context.extensionPath);
    }
  });

  // Check on open
  const onOpen = vscode.workspace.onDidOpenTextDocument(async (document) => {
    if (document.languageId === 'php') {
      await checkDocument(document, context.extensionPath);
    }
  });

  // Check currently open document on activation
  if (vscode.window.activeTextEditor?.document.languageId === 'php') {
    checkDocument(vscode.window.activeTextEditor.document, context.extensionPath);
  }

  context.subscriptions.push(checkCommand, onSave, onOpen, diagnosticCollection, outputChannel);
}

async function checkDocument(document: vscode.TextDocument, extensionPath: string): Promise<void> {
  const filePath = document.uri.fsPath;
  const fileName = path.basename(filePath);

  // Log start of analysis
  const timestamp = new Date().toLocaleTimeString();
  outputChannel.appendLine('');
  outputChannel.appendLine(`[${timestamp}] Starting analysis...`);
  outputChannel.appendLine(`File: ${fileName}`);
  outputChannel.appendLine(`Full path: ${filePath}`);

  try {
    // Get configuration
    const config = vscode.workspace.getConfiguration('phpmnd');
    const ignoreNumbers = config.get<string[]>('ignoreNumbers', []);
    const ignoreStrings = config.get<string[]>('ignoreStrings', []);

    // Path to bundled phpmnd.phar
    const phpmndPath = path.join(extensionPath, 'phpmnd.phar');
    outputChannel.appendLine(`Using phpmnd: ${phpmndPath}`);

    // Build command with options
    let command = `php "${phpmndPath}" "${filePath}" --non-zero-exit-on-violation --hint`;

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

    // Execute phpmnd
    const { stdout, stderr } = await execAsync(command, {
      cwd: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
    });

    const duration = Date.now() - startTime;
    const output = stdout + stderr;

    // Parse output and create diagnostics
    const diagnostics = parsePhpmndOutput(output, document);
    diagnosticCollection.set(document.uri, diagnostics);

    // Log results
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
    const duration = Date.now() - Date.now();

    // phpmnd returns non-zero exit code when violations are found
    if (error.stdout || error.stderr) {
      const output = error.stdout + error.stderr;
      const diagnostics = parsePhpmndOutput(output, document);
      diagnosticCollection.set(document.uri, diagnostics);

      // Log results
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
      // Real error - phpmnd execution failed
      const errorTimestamp = new Date().toLocaleTimeString();
      outputChannel.appendLine(`[${errorTimestamp}] ✗ Error running phpmnd`);
      outputChannel.appendLine(`Error: ${error.message}`);

      if (error.stderr) {
        outputChannel.appendLine('stderr:');
        outputChannel.appendLine(error.stderr);
      }

      console.error('Error running phpmnd:', error);

      // Only show error message once per session
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

      // Clear diagnostics if phpmnd can't run
      diagnosticCollection.set(document.uri, []);
    }
  }
}

let hasShownError = false;

function parsePhpmndOutput(output: string, document: vscode.TextDocument): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Parse phpmnd output format: path/to/file.php:123 Magic number: 42
    // Or: path/to/file.php:123: Magic number: 42
    const match = line.match(/^.*?:(\d+):?\s+(.+)/);

    if (match) {
      const lineNumber = parseInt(match[1], 10) - 1; // VS Code uses 0-based line numbers
      const message = match[2].trim();

      if (lineNumber >= 0 && lineNumber < document.lineCount) {
        const lineText = document.lineAt(lineNumber).text;

        // Try to find the magic number in the line
        const numberMatch = message.match(/Magic number: ([\d.]+)/);
        let range: vscode.Range;

        if (numberMatch) {
          const magicNumber = numberMatch[1];
          const index = lineText.indexOf(magicNumber);

          if (index !== -1) {
            range = new vscode.Range(lineNumber, index, lineNumber, index + magicNumber.length);
          } else {
            // Fallback: highlight the whole line
            range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
          }
        } else {
          // Fallback: highlight the whole line
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

// This method is called when your extension is deactivated
export function deactivate() {
  diagnosticCollection.clear();
  diagnosticCollection.dispose();
}
