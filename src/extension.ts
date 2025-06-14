// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as axe from 'axe-core';

// File patterns to scan
const SCAN_PATTERNS = ['**/*.html'];

// extended patterns - , '**/*.jsx', '**/*.tsx', '**/*.js', '**/*.ts', '**/*.css'

// Folders to exclude
const EXCLUDE_PATTERNS = [
	'**/node_modules/**',
	'**/dist/**',
	'**/build/**',
	'**/.git/**',
	'**/coverage/**'
];

// Track active webview panels
const webviewPanels = new Map<string, vscode.WebviewPanel>();

// Create a diagnostic collection for accessibility issues
let accessibilityDiagnostics: vscode.DiagnosticCollection;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Scout accessibility assistant is now active');

	// Initialize the diagnostic collection
	accessibilityDiagnostics = vscode.languages.createDiagnosticCollection('accessibility');

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
				for (const file of selectedFiles) {
					await displayFileInWebview(file.filePath, context);
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Error scanning workspace: ${error}`);
		}
	});

	context.subscriptions.push(scanCommand);
}

// Display file content in a webview panel
async function displayFileInWebview(filePath: string, context: vscode.ExtensionContext) {
	try {
		// Check if we already have a panel for this file
		const existingPanel = webviewPanels.get(filePath);
		if (existingPanel) {
			existingPanel.reveal();
			return;
		}

		// Read the file content
		const content = await fs.promises.readFile(filePath, 'utf8');
		const fileName = path.basename(filePath);

		// Create and show a new webview panel
		const panel = vscode.window.createWebviewPanel(
			'htmlPreview',
			`Preview: ${fileName}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(context.extensionUri, 'dist')
				]
			}
		);

		// Set the webview content
		panel.webview.html = getWebviewContent(content, context, panel.webview);

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.type) {
					case 'accessibilityResults':
						handleAccessibilityResults(message.results, filePath);
						break;
				}
			},
			undefined,
			context.subscriptions
		);

		// Handle panel disposal
		panel.onDidDispose(() => {
			webviewPanels.delete(filePath);
		});

		// Store the panel reference
		webviewPanels.set(filePath, panel);
	} catch (error) {
		vscode.window.showErrorMessage(`Error displaying file: ${error}`);
	}
}

// Generate webview content with accessibility checking
function getWebviewContent(htmlContent: string, context: vscode.ExtensionContext, webview: vscode.Webview): string {
	// Get the path to axe-core in the extension's dist folder
	const axeCoreUri = webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'dist', 'axe.min.js')
	);

	return `<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<script src="${axeCoreUri}"></script>
			<style>
				html {
					background-color: white;
				}
				/* Apply default text color based on VS Code theme classes */
				body {
					color: black;
				}
			</style>
		</head>
		<body>
			${htmlContent}
			<script>
				(function() {
					const vscode = acquireVsCodeApi();
					(async function() {
						try {
							// Run axe-core analysis
							const results = await axe.run(document);
							
							// Send results back to extension
							vscode.postMessage({
								type: 'accessibilityResults',
								results: results
							});
						} catch (error) {
							console.error('Error running accessibility analysis:', error);
						}
					})();
				})();
			</script>
		</body>
		</html>`;
}

// Handle accessibility results and create diagnostics
function handleAccessibilityResults(results: axe.AxeResults, filePath: string) {
	const diagnostics: vscode.Diagnostic[] = [];
	const uri = vscode.Uri.file(filePath);

	// Log the results for debugging
	console.log('Received accessibility results for', filePath, results);

	// Process each violation
	for (const violation of results.violations) {
		for (const node of violation.nodes) {
			// Set diagnostic range to the first line (temporary MVP solution)
			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(0, 0, 0, 100),
				`${violation.help}: ${violation.description}\nSelector: ${node.target.join(', ')}`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.source = 'Accessibility';
			diagnostic.code = violation.id;
			diagnostic.relatedInformation = [
				new vscode.DiagnosticRelatedInformation(
					new vscode.Location(uri, new vscode.Range(0, 0, 0, 100)),
					`Impact: ${violation.impact}`
				)
			];
			diagnostics.push(diagnostic);
		}
	}

	// Log diagnostics for debugging
	console.log('Setting diagnostics for', filePath, diagnostics);

	// Update the diagnostic collection
	accessibilityDiagnostics.set(uri, diagnostics);
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
export function deactivate() {
	accessibilityDiagnostics.dispose();
}
