import MistralClient from '@mistralai/mistralai';
import * as vscode from 'vscode';

export class AIService {
    private client: MistralClient | null = null;

    constructor() {
        console.log('[Scout AI Service] Initializing AI service...');
        this.initializeClient();
    }

    private initializeClient() {
        const config = vscode.workspace.getConfiguration('scout');
        const apiKey = config.get<string>('mistralApiKey');

        if (apiKey) {
            console.log('[Scout AI Service] API key found, initializing MistralAI client');
            this.client = new MistralClient(apiKey);
        } else {
            console.warn('[Scout AI Service] No API key found in settings');
        }
    }

    public async testConnection(prompt: string): Promise<boolean> {
        console.log('[Scout AI Service] Testing connection with prompt:', prompt);
        
        if (!this.client) {
            console.error('[Scout AI Service] Client not initialized for connection test');
            throw new Error('MistralAI client not initialized. Please set your API key in settings.');
        }

        try {
            console.log('[Scout AI Service] Sending test request to MistralAI...');
            const response = await this.client.chat({
                model: 'mistral-small',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1
            });

            const success = response.choices[0]?.message?.content !== undefined;
            console.log('[Scout AI Service] Connection test result:', success);
            return success;
        } catch (error) {
            console.error('[Scout AI Service] Connection test failed:', error);
            throw error;
        }
    }

    public async getAccessibilityFix(
        originalNodeHtml: string,
        issue: {
            id: string;
            description: string;
            help: string;
            impact: string;
        }
    ): Promise<string | null> {
        console.log('[Scout AI Service] Getting accessibility fix for issue:', issue.id);
        console.log('[Scout AI Service] Issue details:', {
            description: issue.description,
            help: issue.help,
            impact: issue.impact
        });

        if (!this.client) {
            console.error('[Scout AI Service] Client not initialized for fix generation');
            throw new Error('MistralAI client not initialized. Please set your API key in settings.');
        }

        try {
            // Initialize prompt variable
            let prompt: string;

            // Specialized prompt for list items
            if (issue.id === 'listitem') {
                console.log('[Scout AI Service] Using specialized prompt for list items');
                prompt = `You are an expert web developer with extensive experience in improving web accessibility.

Fix this list item accessibility issue:
${originalNodeHtml}

Instructions:
- Wrap the <li> in an <ol> (ordered list) element
- Keep existing content and attributes
- Return ONLY the fixed HTML, no explanations or alternatives
- Do not include markdown code blocks or backticks
- Do not provide multiple options, just use <ol>`;
            } else if (issue.id === 'image-alt') {
                console.log('[Scout AI Service] Using specialized prompt for image alt text');
                prompt = `You are an expert web developer with extensive experience in improving web accessibility.

Add an alt attribute to this image:
${originalNodeHtml}

Instructions:
- Add a short, descriptive alt attribute based on the image filename
- If filename is not descriptive or not found, use "decorative image"
- Do not include "image of" or "picture of"
- Keep existing attributes
- Return only the fixed HTML (no explanations, no markdown, no alternatives)`;
            } else if (issue.id === 'region') {
                console.log('[Scout AI Service] Using specialized prompt for region landmark');
                prompt = `You are an expert web developer with extensive experience in improving web accessibility.

Fix this region landmark issue:
${originalNodeHtml}

Instructions:
- Wrap the content in a <main> element if it's the main content
- Or wrap in a <nav> element if it's navigation
- Or wrap in a <aside> element if it's complementary content
- Or wrap in a <section> element with appropriate ARIA role if it's a distinct section
- Keep existing content and attributes
- Return ONLY the fixed HTML, no explanations or alternatives
- Do not include markdown code blocks or backticks`;
            } else {
                throw new Error(`Unsupported issue type: ${issue.id}`);
            }

            console.log('[Scout AI Service] Request configuration:', {
                model: 'mistral-small',
                messageLength: prompt.length,
                temperature: 0.1
            });

            // Verify message length before sending
            if (prompt.length > 4000) {
                throw new Error(`Prompt is too long (${prompt.length} characters). Maximum allowed is 4000 characters.`);
            }

            try {
                const response = await this.client.chat({
                    model: 'mistral-small',
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.1
                });

                console.log('[Scout AI Service] Received response from MistralAI:', {
                    hasChoices: !!response.choices,
                    choiceCount: response.choices?.length,
                    hasMessage: !!response.choices?.[0]?.message,
                    hasContent: !!response.choices?.[0]?.message?.content,
                    responseType: typeof response.choices?.[0]?.message?.content,
                    content: response.choices?.[0]?.message?.content
                });

                if (!response.choices?.[0]?.message?.content) {
                    throw new Error('No content in AI response');
                }

                // Clean up the response to get only the HTML
                let fix = response.choices[0].message.content;
                
                // Remove markdown code blocks if present
                fix = fix.replace(/```html\n?|\n?```/g, '');
                
                // Remove any explanatory text before or after the HTML
                fix = fix.replace(/^[^<]*|[^>]*$/g, '');
                
                // Trim whitespace
                fix = fix.trim();

                console.log('[Scout AI Service] Cleaned fix content:', fix);

                // Validate the fix
                console.log('[Scout AI Service] Validating fix for issue:', issue.id);
                const isValid = await this.validateFix(fix, issue);
                console.log('[Scout AI Service] Validation result:', isValid);
                if (!isValid) {
                    console.log('[Scout AI Service] Validation failed. Fix content:', fix);
                    throw new Error('AI generated fix failed validation');
                }

                // Add user guidance comment for image-alt issues
                if (issue.id === 'image-alt') {
                    fix = `<!--
Review and enhance this alt text for better context. Learn more: https://accessibility.huit.harvard.edu/describe-content-images
-->\n${fix}`;
                }

                return fix;
            } catch (error) {
                console.error('[Scout AI Service] Detailed error in MistralAI request:', {
                    error: error instanceof Error ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    } : error,
                    prompt: prompt.substring(0, 100) + '...', // Log first 100 chars of prompt
                    clientStatus: {
                        isInitialized: !!this.client,
                        apiKeyPresent: !!vscode.workspace.getConfiguration('scout').get<string>('mistralApiKey')
                    }
                });
                throw error;
            }
        } catch (error) {
            console.error('[Scout AI Service] Error in getAccessibilityFix:', error);
            throw error;
        }
    }

    private isValidString(value: unknown): value is string {
        return typeof value === 'string' && value.length > 0;
    }

    public async validateFix(
        fix: string,
        issue: {
            id: string;
            description: string;
            help: string;
        }
    ): Promise<boolean> {
        try {
            console.log('[Scout AI Service] Sending validation request to MistralAI...');
            console.log('[Scout AI Service] Fix to validate:', fix);
            console.log('[Scout AI Service] Issue details:', {
                id: issue.id,
                description: issue.description,
                help: issue.help
            });

            // @ts-ignore - TypeScript is being overly cautious about null checks
            const response = await this.client.chat({
                model: 'mistral-small',
                messages: [{
                    role: 'user',
                    content: `Validate this HTML fix for accessibility issue "${issue.id}":
                    Issue: ${issue.description}
                    Help: ${issue.help}
                    Fix: ${fix}
                    
                    Respond with ONLY "true" if the fix is valid, or "false" if it's invalid.`
                }],
                temperature: 0.1
            });

            if (!response?.choices?.[0]?.message?.content) {
                console.error('[Scout AI Service] Invalid response structure:', JSON.stringify(response, null, 2));
                return false;
            }

            const validationResponse = response.choices[0].message.content;
            console.log('[Scout AI Service] Raw validation response:', validationResponse);
            
            // Extract the first word and check if it's "true" (case insensitive)
            // Remove any punctuation and trim whitespace
            const firstWord = validationResponse.trim().split(/\s+/)[0].toLowerCase().replace(/[.,!?]$/, '');
            const isValid = firstWord === 'true';
            
            console.log('[Scout AI Service] Validation result:', {
                rawResponse: validationResponse,
                firstWord,
                parsedResult: isValid
            });
            
            return isValid;
        } catch (error) {
            console.error('[Scout AI Service] Error validating fix:', error);
            if (error instanceof Error) {
                console.error('[Scout AI Service] Error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
            }
            return false;
        }
    }
} 