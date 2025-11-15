import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

// Diagnostic collection for magic numbers
const diagnosticCollection = vscode.languages.createDiagnosticCollection('phpmnd');

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log('PHP Magic Number Detector extension is now active!');

  // Register command to manually check current file
  const checkCommand = vscode.commands.registerCommand(
    'php-magic-number-detector.check',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'php') {
        await checkDocument(editor.document);
      } else {
        vscode.window.showWarningMessage('Please open a PHP file to check for magic numbers.');
      }
    }
  );

  // Check on save
  const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (document.languageId === 'php') {
      await checkDocument(document);
    }
  });

  // Check on open
  const onOpen = vscode.workspace.onDidOpenTextDocument(async (document) => {
    if (document.languageId === 'php') {
      await checkDocument(document);
    }
  });

  // Check currently open document on activation
  if (vscode.window.activeTextEditor?.document.languageId === 'php') {
    checkDocument(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(checkCommand, onSave, onOpen, diagnosticCollection);
}

async function checkDocument(document: vscode.TextDocument): Promise<void> {
  const filePath = document.uri.fsPath;

  try {
    // Get configuration
    const config = vscode.workspace.getConfiguration('phpmnd');
    const phpmndPath = config.get<string>('executablePath', 'phpmnd');
    const ignoreNumbers = config.get<string[]>('ignoreNumbers', []);
    const ignoreStrings = config.get<string[]>('ignoreStrings', []);

    // Build command with options
    let command = `${phpmndPath} "${filePath}" --non-zero-exit-on-violation --hint`;

    if (ignoreNumbers.length > 0) {
      command += ` --ignore-numbers=${ignoreNumbers.join(',')}`;
    }

    if (ignoreStrings.length > 0) {
      command += ` --ignore-strings=${ignoreStrings.join(',')}`;
    }

    // Execute phpmnd
    const { stdout, stderr } = await execAsync(command, {
      cwd: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
    });

    // Parse output and create diagnostics
    const diagnostics = parsePhpmndOutput(stdout + stderr, document);
    diagnosticCollection.set(document.uri, diagnostics);
  } catch (error: any) {
    // phpmnd returns non-zero exit code when violations are found
    if (error.stdout || error.stderr) {
      const diagnostics = parsePhpmndOutput(error.stdout + error.stderr, document);
      diagnosticCollection.set(document.uri, diagnostics);
    } else {
      // Real error - phpmnd might not be installed
      console.error('Error running phpmnd:', error);

      // Only show error message once per session
      if (!hasShownError) {
        hasShownError = true;
        const response = await vscode.window.showErrorMessage(
          'phpmnd not found. Please install it: composer global require povils/phpmnd',
          'Learn More'
        );
        if (response === 'Learn More') {
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
