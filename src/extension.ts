// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// File patterns to scan
const SCAN_PATTERNS = ['**/*.html', '**/*.jsx', '**/*.tsx', '**/*.js', '**/*.ts', '**/*.css'];

// Folders to exclude
const EXCLUDE_PATTERNS = [
	'**/node_modules/**',
	'**/dist/**',
	'**/build/**',
	'**/.git/**',
	'**/coverage/**'
];

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Scout accessibility assistant is now active');

	// Register the scan workspace command
	const scanCommand = vscode.commands.registerCommand('scout.scanWorkspace', async () => {
		try {
			const files = await findRelevantFiles();
			if (files.length === 0) {
				vscode.window.showInformationMessage('No HTML/JSX/CSS files found in the workspace.');
				return;
			}

			// Show found files in a quick pick menu
			const selectedFiles = await vscode.window.showQuickPick(
				files.map(file => ({
					label: path.basename(file),
					description: file,
					filePath: file
				})),
				{
					canPickMany: true,
					placeHolder: 'Select files to scan for accessibility issues'
				}
			);

			if (selectedFiles) {
				vscode.window.showInformationMessage(
					`Found ${selectedFiles.length} file(s) to scan. This will be implemented in the next step.`
				);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Error scanning workspace: ${error}`);
		}
	});

	context.subscriptions.push(scanCommand);
}

// Find all relevant files in the workspace
async function findRelevantFiles(): Promise<string[]> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return [];
	}

	const files: string[] = [];

	for (const folder of workspaceFolders) {
		for (const pattern of SCAN_PATTERNS) {
			const matches = await vscode.workspace.findFiles(
				pattern,
				`{${EXCLUDE_PATTERNS.join(',')}}`
			);
			files.push(...matches.map(uri => uri.fsPath));
		}
	}

	return files;
}

// This method is called when your extension is deactivated
export function deactivate() {}
