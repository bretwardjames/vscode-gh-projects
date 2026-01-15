import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BranchIssueLink {
    branchName: string;
    issueNumber: number;
    issueTitle: string;
    projectItemId: string;
    linkedAt: string;
}

const STORAGE_KEY = 'ghProjects.branchLinks';

export class BranchLinker {
    private _context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    /**
     * Get all branch-issue links for this workspace
     */
    getLinks(): BranchIssueLink[] {
        return this._context.workspaceState.get<BranchIssueLink[]>(STORAGE_KEY, []);
    }

    /**
     * Link a branch to an issue
     */
    async linkBranch(
        branchName: string,
        issueNumber: number,
        issueTitle: string,
        projectItemId: string
    ): Promise<void> {
        const links = this.getLinks();

        // Remove any existing link for this issue or branch
        const filtered = links.filter(
            l => l.projectItemId !== projectItemId && l.branchName !== branchName
        );

        filtered.push({
            branchName,
            issueNumber,
            issueTitle,
            projectItemId,
            linkedAt: new Date().toISOString(),
        });

        await this._context.workspaceState.update(STORAGE_KEY, filtered);
    }

    /**
     * Get the branch linked to an issue
     */
    getBranchForIssue(projectItemId: string): string | null {
        const links = this.getLinks();
        const link = links.find(l => l.projectItemId === projectItemId);
        return link?.branchName || null;
    }

    /**
     * Get the issue linked to a branch
     */
    getIssueForBranch(branchName: string): BranchIssueLink | null {
        const links = this.getLinks();
        return links.find(l => l.branchName === branchName) || null;
    }

    /**
     * Remove a link by issue
     */
    async unlinkByIssue(projectItemId: string): Promise<void> {
        const links = this.getLinks();
        const filtered = links.filter(l => l.projectItemId !== projectItemId);
        await this._context.workspaceState.update(STORAGE_KEY, filtered);
    }

    /**
     * Remove a link by branch
     */
    async unlinkByBranch(branchName: string): Promise<void> {
        const links = this.getLinks();
        const filtered = links.filter(l => l.branchName !== branchName);
        await this._context.workspaceState.update(STORAGE_KEY, filtered);
    }

    /**
     * Get current git branch name
     */
    async getCurrentBranch(): Promise<string | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        try {
            const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
                cwd: workspaceFolder.uri.fsPath,
            });
            return stdout.trim();
        } catch {
            return null;
        }
    }

    /**
     * Get all local branches
     */
    async getLocalBranches(): Promise<string[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            const { stdout } = await execAsync('git branch --format="%(refname:short)"', {
                cwd: workspaceFolder.uri.fsPath,
            });
            return stdout
                .split('\n')
                .map(b => b.trim())
                .filter(b => b.length > 0);
        } catch {
            return [];
        }
    }

    /**
     * Get all remote branches (excluding HEAD)
     */
    async getRemoteBranches(): Promise<string[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            // Fetch latest remote info first
            await execAsync('git fetch --prune', {
                cwd: workspaceFolder.uri.fsPath,
            });

            const { stdout } = await execAsync('git branch -r --format="%(refname:short)"', {
                cwd: workspaceFolder.uri.fsPath,
            });
            return stdout
                .split('\n')
                .map(b => b.trim())
                .filter(b => b.length > 0 && !b.includes('HEAD'))
                .map(b => b.replace(/^origin\//, '')); // Strip origin/ prefix
        } catch {
            return [];
        }
    }

    /**
     * Check if the current branch is pushed to remote
     */
    async isCurrentBranchPushed(): Promise<{ pushed: boolean; branchName: string | null }> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { pushed: false, branchName: null };
        }

        try {
            const branchName = await this.getCurrentBranch();
            if (!branchName) {
                return { pushed: false, branchName: null };
            }

            // Check if there's a remote tracking branch
            const { stdout } = await execAsync(
                `git rev-parse --abbrev-ref ${branchName}@{upstream} 2>/dev/null || echo ""`,
                { cwd: workspaceFolder.uri.fsPath }
            );

            return { pushed: stdout.trim().length > 0, branchName };
        } catch {
            const branchName = await this.getCurrentBranch();
            return { pushed: false, branchName };
        }
    }

    /**
     * Push current branch to remote
     */
    async pushCurrentBranch(): Promise<{ success: boolean; error?: string }> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { success: false, error: 'No workspace folder' };
        }

        try {
            const branchName = await this.getCurrentBranch();
            if (!branchName) {
                return { success: false, error: 'Not on a branch' };
            }

            await execAsync(`git push -u origin "${branchName}"`, {
                cwd: workspaceFolder.uri.fsPath,
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Check if a branch exists locally
     */
    async branchExists(branchName: string): Promise<boolean> {
        const branches = await this.getLocalBranches();
        return branches.includes(branchName);
    }

    /**
     * Check if a branch exists on remote
     */
    async remoteBranchExists(branchName: string): Promise<boolean> {
        const branches = await this.getRemoteBranches();
        return branches.includes(branchName);
    }

    /**
     * Switch to a branch (handles both local and remote branches)
     */
    async switchToBranch(branchName: string): Promise<{ success: boolean; error?: string }> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { success: false, error: 'No workspace folder open' };
        }

        try {
            // Check for uncommitted changes
            const { stdout: statusOutput } = await execAsync('git status --porcelain', {
                cwd: workspaceFolder.uri.fsPath,
            });

            if (statusOutput.trim()) {
                // There are uncommitted changes - ask user what to do
                const choice = await vscode.window.showWarningMessage(
                    'You have uncommitted changes. What would you like to do?',
                    'Stash and Switch',
                    'Switch Anyway',
                    'Cancel'
                );

                if (choice === 'Cancel' || !choice) {
                    return { success: false, error: 'Cancelled by user' };
                }

                if (choice === 'Stash and Switch') {
                    await execAsync('git stash push -m "Auto-stash before switching to ' + branchName + '"', {
                        cwd: workspaceFolder.uri.fsPath,
                    });
                }
            }

            // Check if branch exists locally
            const localBranches = await this.getLocalBranches();
            const existsLocally = localBranches.includes(branchName);

            if (existsLocally) {
                // Simple checkout
                await execAsync(`git checkout "${branchName}"`, {
                    cwd: workspaceFolder.uri.fsPath,
                });
            } else {
                // Check if it exists on remote
                const remoteBranches = await this.getRemoteBranches();
                const existsRemotely = remoteBranches.includes(branchName);

                if (existsRemotely) {
                    // Create local tracking branch from remote
                    await execAsync(`git checkout -b "${branchName}" "origin/${branchName}"`, {
                        cwd: workspaceFolder.uri.fsPath,
                    });
                } else {
                    return { success: false, error: `Branch "${branchName}" not found locally or on remote` };
                }
            }

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }
}
