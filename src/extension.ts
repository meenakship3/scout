// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as axe from 'axe-core';
import { AIService } from './ai-service';
import * as beautify from 'js-beautify';

// Extend Diagnostic type to include our custom data
interface AccessibilityDiagnostic extends vscode.Diagnostic {
	data?: {
		violation: axe.Result;
		node: axe.NodeResult;
	};
}

type FixAllResult = 
	| { status: 'fixed'; count: number; originalContent: string }
	| { status: 'no_fixes'; count: 0 }
	| { status: 'cancelled'; count: number; originalContent: string };

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
let aiService: AIService;

// Store the extension context globally
let extensionContext: vscode.ExtensionContext;

// Function to re-run accessibility analysis for a file
async function reRunAnalysisForFile(filePath: string) {
	const panel = webviewPanels.get(filePath);
	if (panel) {
		try {
			// Read the current file content
			const content = await fs.promises.readFile(filePath, 'utf8');
			
			// Update the webview content
			panel.webview.html = getWebviewContent(content, extensionContext, panel.webview);
			
			// Send message to re-run analysis
			panel.webview.postMessage({ type: 'reRunAnalysis' });
		} catch (error) {
			console.error(`Error re-running analysis for ${filePath}:`, error);
		}
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	extensionContext = context;
	console.log('Scout accessibility assistant is now active');

	// Initialize services
	accessibilityDiagnostics = vscode.languages.createDiagnosticCollection('accessibility');
	aiService = new AIService();

	// Create a file system watcher for HTML files
	const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.html');
	
	// Watch for file changes
	fileWatcher.onDidChange(async (uri) => {
		const filePath = uri.fsPath;
		// Clear existing diagnostics for this file
		accessibilityDiagnostics.delete(uri);
		// Re-run analysis
		await reRunAnalysisForFile(filePath);
	});

	// Watch for file deletions
	fileWatcher.onDidDelete((uri) => {
		// Remove diagnostics when file is deleted
		accessibilityDiagnostics.delete(uri);
	});

	// Watch for file creations
	fileWatcher.onDidCreate(async (uri) => {
		const filePath = uri.fsPath;
		await reRunAnalysisForFile(filePath);
	});

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

	// Register code action provider for accessibility fixes
	const codeActionProvider = vscode.languages.registerCodeActionsProvider(
		['html', 'jsx', 'tsx'],
		new AccessibilityCodeActionProvider(),
		{
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
		}
	);

	// Register verify API key command
	const verifyApiKeyCommand = vscode.commands.registerCommand('scout.verifyApiKey', async () => {
		try {
			const config = vscode.workspace.getConfiguration('scout');
			const apiKey = config.get<string>('mistralApiKey');

			if (!apiKey) {
				vscode.window.showErrorMessage('MistralAI API key not found. Please set it in your user settings.');
				return;
			}

			// Test the API key with a simple request
			const testPrompt = 'Test connection';
			const response = await aiService.testConnection(testPrompt);
			
			if (response) {
				vscode.window.showInformationMessage('MistralAI API key is valid and working!');
			}
		} catch (error) {
			vscode.window.showErrorMessage(`API key verification failed: ${error}`);
		}
	});

	// Register the AI fix command
	vscode.commands.registerCommand('scout.getAIFix', async (document: vscode.TextDocument, diagnostic: AccessibilityDiagnostic) => {
		try {
			if (!diagnostic.data || !diagnostic.range) {
				throw new Error('No accessibility data or range found in diagnostic');
			}

			const { violation, node } = diagnostic.data;
			
			// Get AI fix for the specific node HTML
			const fixedCode = await aiService.getAccessibilityFix(node.html || '', {
				id: violation.id,
				description: violation.description,
				help: violation.help,
				impact: violation.impact || 'moderate'
			});

			if (!fixedCode) {
				throw new Error('No fix was generated');
			}

			// Validate the fix
			const isValid = await aiService.validateFix(fixedCode as string, {
				id: violation.id,
				description: violation.description,
				help: violation.help
			});

			if (isValid) {
				// Create a workspace edit
				const edit = new vscode.WorkspaceEdit();
				
				// For main landmark issues, replace the entire document
				if (violation.id === 'landmark-one-main') {
					edit.replace(
						document.uri,
						new vscode.Range(
							document.positionAt(0),
							document.positionAt(document.getText().length)
						),
						fixedCode as string
					);
				} else {
					// For other issues, find the exact location of the element using the node's target
					const documentText = document.getText();
					const nodeHtml = node.html || '';
					const startIndex = documentText.indexOf(nodeHtml);
					
					if (startIndex === -1) {
						throw new Error('Could not find the element in the document');
					}
					
					const endIndex = startIndex + nodeHtml.length;
					const startPosition = document.positionAt(startIndex);
					const endPosition = document.positionAt(endIndex);
					
					edit.replace(
						document.uri,
						new vscode.Range(startPosition, endPosition),
						fixedCode as string
					);
				}

				// Store the original content before making changes
				const originalContent = document.getText();
				
				// Apply the edit
				await vscode.workspace.applyEdit(edit);
				
				// Format the entire document
				const formattedContent = beautify.html(document.getText(), {
					indent_size: 2,
					wrap_line_length: 100,
					preserve_newlines: true,
					max_preserve_newlines: 2,
					unformatted: ['code', 'pre', 'em', 'strong', 'span'],
					indent_inner_html: true,
					indent_scripts: 'keep'
				});

				// Create a new edit to apply the formatting
				const formatEdit = new vscode.WorkspaceEdit();
				formatEdit.replace(
					document.uri,
					new vscode.Range(
						document.positionAt(0),
						document.positionAt(document.getText().length)
					),
					formattedContent
				);

				// Apply the formatting
				await vscode.workspace.applyEdit(formatEdit);
				
				// Show message with buttons
				const message = await vscode.window.showInformationMessage(
					'Accessibility fix applied successfully!',
					{ modal: false },
					'Accept Changes',
					'Reject Changes'
				);

				if (message === 'Reject Changes') {
					console.log('[Scout] Reverting changes...');
					// Create a new edit to revert the changes
					const undoEdit = new vscode.WorkspaceEdit();
					undoEdit.replace(
						document.uri,
						new vscode.Range(
							document.positionAt(0),
							document.positionAt(document.getText().length)
						),
						originalContent
					);
					const success = await vscode.workspace.applyEdit(undoEdit);
					if (success) {
						vscode.window.showInformationMessage('Changes have been reverted.');
					} else {
						vscode.window.showErrorMessage('Failed to revert changes.');
					}
				} else { // User accepted changes or dismissed the message
					// Save the document
					await document.save();
					// Ensure the file is saved to disk
					await vscode.workspace.fs.writeFile(
						document.uri,
						Buffer.from(document.getText())
					);
				}
			} else {
				vscode.window.showWarningMessage('AI generated fix was not valid. Please review manually.');
			}
		} catch (error) {
			console.error('[Scout] Error in getAIFix command:', error instanceof Error ? error.message : 'Unknown error');
			vscode.window.showErrorMessage("Error getting AI fix");
		}
	});

	// Register the Fix All command
	vscode.commands.registerCommand('scout.fixAll', async (document?: vscode.TextDocument) => {
		try {
			// If document is not provided, get the active document
			if (!document) {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					vscode.window.showErrorMessage('No active editor found. Please open an HTML/JSX/TSX file.');
					return;
				}
				document = activeEditor.document;
			}

			// Ensure we have a valid document
			if (!document) {
				vscode.window.showErrorMessage('No valid document found. Please open an HTML/JSX/TSX file.');
				return;
			}

			// At this point, document is guaranteed to be defined
			const doc = document;

			// Get all accessibility diagnostics for the current document
			const allDiagnostics = accessibilityDiagnostics.get(doc.uri) || [];
			const filteredDiagnostics = allDiagnostics.filter((d: vscode.Diagnostic) => d.source === 'Accessibility') as AccessibilityDiagnostic[];

			if (filteredDiagnostics.length === 0) {
				vscode.window.showInformationMessage('No accessibility issues found to fix.');
				return;
			}

			// Show progress
			const fixResult: FixAllResult = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Fixing accessibility issues...",
				cancellable: true
			}, async (progress, token) => {
				// Create a workspace edit to hold all changes
				const edit = new vscode.WorkspaceEdit();
				let fixedCount = 0;
				const originalContentBeforeFix = doc.getText();

				// Process each diagnostic
				for (const diagnostic of filteredDiagnostics) {
					if (token.isCancellationRequested) {
						return { status: 'cancelled', count: fixedCount, originalContent: originalContentBeforeFix };
					}

					if (!diagnostic.data || !diagnostic.range) {
						continue;
					}

					const { violation, node } = diagnostic.data;
					
					// Only process label, image-alt, and listitem issues
					if (!['label', 'image-alt', 'listitem'].includes(violation.id)) {
						continue;
					}

					try {
						// Get AI fix
						const fixedCode = await aiService.getAccessibilityFix(node.html || '', {
							id: violation.id,
							description: violation.description,
							help: violation.help,
							impact: violation.impact || 'moderate'
						});

						if (!fixedCode) {
							continue;
						}

						// Validate the fix
						const isValid = await aiService.validateFix(fixedCode, {
							id: violation.id,
							description: violation.description,
							help: violation.help
						});

						if (isValid) {
							// Find the exact location of the element
							const documentText = doc.getText();
							const nodeHtml = node.html || '';
							const startIndex = documentText.indexOf(nodeHtml);
							
							if (startIndex === -1) {
								continue;
							}
							
							const endIndex = startIndex + nodeHtml.length;
							const startPosition = doc.positionAt(startIndex);
							const endPosition = doc.positionAt(endIndex);
							
							// Add the fix to the workspace edit
							edit.replace(
								doc.uri,
								new vscode.Range(startPosition, endPosition),
								fixedCode
							);

							fixedCount++;
							progress.report({ increment: 100 / filteredDiagnostics.length });
						}
					} catch (error) {
						console.error(`[Scout] Error fixing issue ${violation.id}:`, error);
					}
				}

				// Apply all changes at once
				if (fixedCount > 0) {
					await vscode.workspace.applyEdit(edit);

					// Format the entire document
					const formattedContent = beautify.html(doc.getText(), {
						indent_size: 2,
						wrap_line_length: 100,
						preserve_newlines: true,
						max_preserve_newlines: 2,
						unformatted: ['code', 'pre', 'em', 'strong', 'span'],
						indent_inner_html: true,
						indent_scripts: 'keep'
					});

					// Create a new edit to apply the formatting
					const formatEdit = new vscode.WorkspaceEdit();
					formatEdit.replace(
						doc.uri,
						new vscode.Range(
							doc.positionAt(0),
							doc.positionAt(doc.getText().length)
						),
						formattedContent
					);

					// Apply the formatting
					await vscode.workspace.applyEdit(formatEdit);

					return { status: 'fixed', count: fixedCount, originalContent: originalContentBeforeFix };
				} else {
					return { status: 'no_fixes', count: 0 };
				}
			});

			if (fixResult.status === 'fixed') {
				const message = await vscode.window.showInformationMessage(
					`Successfully fixed ${fixResult.count} accessibility issues!`,
					{ modal: false },
					'Accept Changes',
					'Reject Changes'
				);

				if (message === 'Reject Changes') {
					console.log('[Scout] Reverting all changes...');
					// Create a new edit to revert the changes
					const undoEdit = new vscode.WorkspaceEdit();
					undoEdit.replace(
						doc.uri,
						new vscode.Range(
							doc.positionAt(0),
							doc.positionAt(doc.getText().length)
						),
						fixResult.originalContent
					);
					const success = await vscode.workspace.applyEdit(undoEdit);
					if (success) {
						vscode.window.showInformationMessage('All changes have been reverted.');
					} else {
						vscode.window.showErrorMessage('Failed to revert changes.');
					}
				} else { // User accepted changes or dismissed the message
					// Save the document
					await doc.save();
					// Ensure the file is saved to disk
					await vscode.workspace.fs.writeFile(
						doc.uri,
						Buffer.from(doc.getText())
					);
				}
			} else if (fixResult.status === 'no_fixes') {
				vscode.window.showWarningMessage('No accessibility issues were fixed.');
			} else if (fixResult.status === 'cancelled') {
				vscode.window.showInformationMessage(`Fix All operation cancelled. ${fixResult.count} issues were fixed before cancellation.`);
			}
		} catch (error) {
			console.error('[Scout] Error in fixAll command:', error instanceof Error ? error.message : 'Unknown error');
			vscode.window.showErrorMessage("Error fixing accessibility issues");
		}
	});

	context.subscriptions.push(scanCommand, codeActionProvider, verifyApiKeyCommand, fileWatcher);
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
						// Pass the file content along with results
						handleAccessibilityResults(message.results, filePath, content);
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
					
					// Function to run accessibility analysis
					async function runAnalysis() {
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
					}

					// Run initial analysis
					runAnalysis();

					// Listen for messages from the extension
					window.addEventListener('message', event => {
						const message = event.data;
						switch (message.type) {
							case 'reRunAnalysis':
								runAnalysis();
								break;
						}
					});
				})();
			</script>
		</body>
		</html>`;
}

// Handle accessibility results and create diagnostics
function handleAccessibilityResults(results: axe.AxeResults, filePath: string, fileContent: string) {
	const diagnostics: AccessibilityDiagnostic[] = [];
	const uri = vscode.Uri.file(filePath);
	// Use a Set to track unique diagnostic ranges to avoid duplicate quick fixes
	const uniqueDiagnosticLocations = new Set<string>();

	// Log the results for debugging
	console.log('Received accessibility results for', filePath, results);

	// Process each violation
	for (const violation of results.violations) {
		for (const node of violation.nodes) {
			let line = 0;
			let character = 0;

			// Attempt to find the line and character of the problematic node's HTML
			if (node.html) {
				const htmlSnippet = node.html;
				const index = fileContent.indexOf(htmlSnippet);
				if (index !== -1) {
					const lines = fileContent.substring(0, index).split('\n');
					line = lines.length - 1;
					character = lines[lines.length - 1].length;
				}
			}

			// Create a unique key for this diagnostic based on file path, line, and character.
			// This ensures only one quick fix is offered per unique starting position in the editor,
			// even if multiple axe-core issues are found for the same element.
			const diagnosticKey = `${filePath}:${line}:${character}`;

			// If a diagnostic for this exact location already exists, skip adding a new one that triggers quick fix.
			// All axe-core issues will still be logged and can be seen in the Problems panel, but the lightbulb
			// will only show one 'Get AI fix' action per location.
			if (uniqueDiagnosticLocations.has(diagnosticKey)) {
				continue;
			}
			uniqueDiagnosticLocations.add(diagnosticKey);

			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(line, character, line, character + (node.html?.length || 1)), 
				`${violation.help}: ${violation.description}\nSelector: ${node.target.join(', ')}`,
				vscode.DiagnosticSeverity.Warning
			) as AccessibilityDiagnostic;
			diagnostic.source = 'Accessibility';
			diagnostic.code = violation.id;
			diagnostic.relatedInformation = [
				new vscode.DiagnosticRelatedInformation(
					new vscode.Location(uri, new vscode.Range(line, character, line, character + (node.html?.length || 1))), 
					`Impact: ${violation.impact}`
				)
			];
			// Add custom data for AI fixes
			diagnostic.data = {
				violation,
				node
			};
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

// Code action provider for accessibility fixes
class AccessibilityCodeActionProvider implements vscode.CodeActionProvider {
	public async provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): Promise<vscode.CodeAction[]> {
		const actions: vscode.CodeAction[] = [];

		// Add "Fix All" action if there are any accessibility diagnostics
		if (context.diagnostics.some(d => d.source === 'Accessibility')) {
			const fixAllAction = new vscode.CodeAction(
				'Fix All with Scout',
				vscode.CodeActionKind.QuickFix
			);
			fixAllAction.command = {
				command: 'scout.fixAll',
				title: 'Fix all accessibility issues',
				arguments: [document]
			};
			actions.push(fixAllAction);
		}

		// Add individual fix actions
		for (const diagnostic of context.diagnostics) {
			if (diagnostic.source === 'Accessibility' && (diagnostic as AccessibilityDiagnostic).data) {
				const action = new vscode.CodeAction(
					'Fix with Scout',
					vscode.CodeActionKind.QuickFix
				);
				action.diagnostics = [diagnostic];
				action.command = {
					command: 'scout.getAIFix',
					title: 'Get AI fix',
					arguments: [document, diagnostic]
				};
				actions.push(action);
			}
		}

		return actions;
	}
}
