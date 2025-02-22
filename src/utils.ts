import readline from 'readline';

/**
 * CLI prompt helper with proper readline interface
 * @param question - Prompt text to display
 * @returns User input as promise
 */
export async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    const response = await new Promise<string>((resolve) => rl.question(question, resolve));
    rl.close();
    return response;
}
