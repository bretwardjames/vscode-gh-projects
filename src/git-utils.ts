import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitStatus {
    currentBranch: string;
    isOnMainBranch: boolean;
    isBehindOrigin: boolean;
    behindCount: number;
    hasUncommittedChanges: boolean;
}

/**
 * Get the workspace path for git operations
 */
function getWorkspacePath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return null;
    }
    return folders[0].uri.fsPath;
}

/**
 * Execute a git command in the workspace
 */
async function gitExec(command: string): Promise<string> {
    const cwd = getWorkspacePath();
    if (!cwd) {
        throw new Error('No workspace folder open');
    }

    const { stdout } = await execAsync(`git ${command}`, { cwd });
    return stdout.trim();
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(): Promise<string> {
    return gitExec('rev-parse --abbrev-ref HEAD');
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(): Promise<boolean> {
    const status = await gitExec('status --porcelain');
    return status.length > 0;
}

/**
 * Fetch from origin to get latest refs
 */
export async function fetchOrigin(): Promise<void> {
    await gitExec('fetch origin');
}

/**
 * Check how many commits the local branch is behind origin
 */
export async function getCommitsBehind(branch: string): Promise<number> {
    try {
        const result = await gitExec(`rev-list --count ${branch}..origin/${branch}`);
        return parseInt(result, 10) || 0;
    } catch {
        // Branch might not have an upstream
        return 0;
    }
}

/**
 * Get comprehensive git status for the Start Working workflow
 */
export async function getGitStatus(mainBranch: string): Promise<GitStatus> {
    const currentBranch = await getCurrentBranch();
    const isOnMainBranch = currentBranch === mainBranch;

    // Fetch to ensure we have latest refs
    try {
        await fetchOrigin();
    } catch (e) {
        console.warn('Could not fetch from origin:', e);
    }

    const behindCount = isOnMainBranch ? await getCommitsBehind(mainBranch) : 0;
    const uncommittedChanges = await hasUncommittedChanges();

    return {
        currentBranch,
        isOnMainBranch,
        isBehindOrigin: behindCount > 0,
        behindCount,
        hasUncommittedChanges: uncommittedChanges,
    };
}

/**
 * Checkout a branch
 */
export async function checkoutBranch(branch: string): Promise<void> {
    await gitExec(`checkout ${branch}`);
}

/**
 * Pull latest from origin
 */
export async function pullLatest(): Promise<void> {
    await gitExec('pull');
}

/**
 * Create and checkout a new branch
 */
export async function createBranch(branchName: string): Promise<void> {
    await gitExec(`checkout -b ${branchName}`);
}

/**
 * Check if a branch already exists locally or remotely
 */
export async function branchExists(branchName: string): Promise<boolean> {
    try {
        // Check local branches
        const localResult = await gitExec(`branch --list ${branchName}`);
        if (localResult.trim()) {
            return true;
        }

        // Check remote branches
        const remoteResult = await gitExec(`branch -r --list origin/${branchName}`);
        return !!remoteResult.trim();
    } catch {
        return false;
    }
}

/**
 * Sanitize a string for use in a branch name
 * - Lowercase
 * - Replace spaces and special chars with hyphens
 * - Remove consecutive hyphens
 * - Remove leading/trailing hyphens
 */
export function sanitizeForBranchName(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')  // Replace non-alphanumeric with hyphens
        .replace(/-+/g, '-')           // Collapse multiple hyphens
        .replace(/^-|-$/g, '');        // Remove leading/trailing hyphens
}

/**
 * Generate a branch name from a pattern and item details
 */
export function generateBranchName(
    pattern: string,
    variables: {
        user: string;
        number: number | null;
        title: string;
        repo: string | null;
    },
    maxLength: number
): string {
    const sanitizedTitle = sanitizeForBranchName(variables.title);

    let branchName = pattern
        .replace('{user}', variables.user)
        .replace('{number}', variables.number?.toString() || 'draft')
        .replace('{title}', sanitizedTitle)
        .replace('{repo}', variables.repo ? sanitizeForBranchName(variables.repo.split('/')[1] || '') : '');

    // Truncate if needed, preserving the prefix (user/number-)
    if (branchName.length > maxLength) {
        // Find where the title part starts (after user/number-)
        const prefixMatch = branchName.match(/^[^/]+\/\d+-/);
        if (prefixMatch) {
            const prefix = prefixMatch[0];
            const remainingLength = maxLength - prefix.length;
            const truncatedTitle = sanitizedTitle.substring(0, remainingLength).replace(/-$/, '');
            branchName = prefix + truncatedTitle;
        } else {
            branchName = branchName.substring(0, maxLength);
        }
    }

    return branchName;
}
