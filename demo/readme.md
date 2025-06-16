# Getting Started with Scout

**Scout** is your AI-powered accessibility assistant for VS Code. It helps you find and fix issues like missing labels, alt text, and list structures—all from within your editor.

---

## Quick Start

1. **Download the VSIX File**

   - Go to the demo branch and download the `scout-*.vsix` file.

2. **Install Scout**

   - Open VS Code.
   - Go to the Extensions view (click the Extensions icon or press `Ctrl+Shift+X`).
   - Click the “…” menu (three dots) at the top of the Extensions sidebar.
   - Select **Install from VSIX** and choose your downloaded file.

3. **Set Up Your API Key**

   - This extension uses the Mistral Small model, which is free.
   - Open VS Code Settings (File > Preferences > Settings).
   - Search for `scout.mistralApiKey`.
   - Enter your MistralAI API key.

4. **Verify Your API Key**

   - Open the Command Palette (`Ctrl+Shift+P`).
   - Type and select **Scout: Verify API Key**.

5. **Scan Your Files**

   - Open your project in VS Code.
   - Open the Command Palette (`Ctrl+Shift+P`).
   - Type and select **Scout: Scan Workspace for Accessibility Issues**.

6. **Review and Fix Issues**
   - Scout will highlight accessibility issues in your files.
   - Use the lightbulb icon next to the line to see suggested fixes.
   - Click on **Fix with Scout** or **Fix All with Scout** to fix issues.
   - Accept or reject fixes with a single click for full control.

---

## Usage Tips

- **Keyboard Shortcuts:** Use `Cmd+Shift+A` (Mac) or `Ctrl+Shift+A` (Windows/Linux) to scan your workspace.
- **Review and Fix:** Scout will make fixes—accept or reject them as needed.
- **Customize:** Toggle Scout on/off in your settings with `scout.enable`.

---

## Requirements

- **VS Code 1.101.0 or higher**
