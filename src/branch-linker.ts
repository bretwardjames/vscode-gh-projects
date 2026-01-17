/**
 * Branch-issue linking for VSCode extension.
 *
 * Wraps @bretwardjames/ghp-core BranchLinker with VSCode workspaceState storage
 * and adds VSCode-specific git operations with UI integration.
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
    BranchLinker as CoreBranchLinker,
    StorageAdapter,
    BranchLink,
} from '@bretwardjames/ghp-core';
import { getCurrentBranch, hasUncommittedChanges } from './git-utils';

const execAsync = promisify(exec);

const STORAGE_KEY = 'ghProjects.branchLinks';

/**
 * Create a VSCode workspaceState storage adapter for the core BranchLinker.
 */
function createWorkspaceStateAdapter(context: vscode.ExtensionContext): StorageAdapter {
    return {
        load(): BranchLink[] {
            return context.workspaceState.get<BranchLink[]>(STORAGE_KEY, []);
        },
        async save(links: BranchLink[]): Promise<void> {
            await context.workspaceState.update(STORAGE_KEY, links);
        },
    };
}

/**
 * Get the repository name from the workspace folder.
 * Falls back to 'unknown' if no workspace is open.
 */
function getRepoName(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.name || 'unknown';
}

/**
 * Get the workspace path for git operations.
 */
function getWorkspacePath(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.uri.fsPath || null;
}

/**
 * VSCode BranchLinker that wraps the core BranchLinker with
 * workspaceState storage and adds VSCode-specific operations.
 */
export class BranchLinker {
    private _core: CoreBranchLinker;
    private _context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._core = new CoreBranchLinker(createWorkspaceStateAdapter(context));
    }

    /**
     * Get the core linker for advanced operations.
     */
    get core(): CoreBranchLinker {
        return this._core;
    }

    /**
     * Get all branch-issue links for this workspace.
     */
    async getLinks(): Promise<BranchLink[]> {
        const repo = getRepoName();
        return this._core.getLinksForRepo(repo);
    }

    /**
     * Link a branch to an issue.
     */
    async linkBranch(
        branchName: string,
        issueNumber: number,
        issueTitle: string,
        projectItemId: string
    ): Promise<void> {
        const repo = getRepoName();
        await this._core.link(branchName, issueNumber, issueTitle, projectItemId, repo);
    }

    /**
     * Get the branch linked to an issue.
     */
    async getBranchForIssue(projectItemId: string): Promise<string | null> {
        // Note: Core uses issueNumber, but we have itemId. Let's find by itemId.
        const links = await this.getLinks();
        const link = links.find(l => l.itemId === projectItemId);
        return link?.branch || null;
    }

    /**
     * Get the branch linked to an issue by issue number.
     */
    async getBranchForIssueNumber(issueNumber: number): Promise<string | null> {
        const repo = getRepoName();
        return this._core.getBranchForIssue(repo, issueNumber);
    }

    /**
     * Get the issue linked to a branch.
     */
    async getIssueForBranch(branchName: string): Promise<BranchLink | null> {
        const repo = getRepoName();
        return this._core.getLinkForBranch(repo, branchName);
    }

    /**
     * Remove a link by issue item ID.
     */
    async unlinkByIssue(projectItemId: string): Promise<void> {
        const links = await this._core.getAllLinks();
        const link = links.find(l => l.itemId === projectItemId);
        if (link) {
            await this._core.unlink(link.repo, link.issueNumber);
        }
    }

    /**
     * Remove a link by branch.
     */
    async unlinkByBranch(branchName: string): Promise<void> {
        const repo = getRepoName();
        await this._core.unlinkBranch(repo, branchName);
    }

    /**
     * Get current git branch name.
     * Uses the shared git-utils from core.
     */
    async getCurrentBranch(): Promise<string | null> {
        try {
            const branch = await getCurrentBranch();
            return branch === 'HEAD' ? null : branch;
        } catch {
            return null;
        }
    }

    /**
     * Get all local branches.
     */
    async getLocalBranches(): Promise<string[]> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return [];
        }

        try {
            const { stdout } = await execAsync('git branch --format="%(refname:short)"', { cwd });
            return stdout
                .split('\n')
                .map(b => b.trim())
                .filter(b => b.length > 0);
        } catch {
            return [];
        }
    }

    /**
     * Get all remote branches (excluding HEAD).
     */
    async getRemoteBranches(): Promise<string[]> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return [];
        }

        try {
            // Fetch latest remote info first
            await execAsync('git fetch --prune', { cwd });

            const { stdout } = await execAsync('git branch -r --format="%(refname:short)"', { cwd });
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
     * Check if the current branch is pushed to remote.
     */
    async isCurrentBranchPushed(): Promise<{ pushed: boolean; branchName: string | null }> {
        const cwd = getWorkspacePath();
        if (!cwd) {
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
                { cwd }
            );

            return { pushed: stdout.trim().length > 0, branchName };
        } catch {
            const branchName = await this.getCurrentBranch();
            return { pushed: false, branchName };
        }
    }

    /**
     * Push current branch to remote.
     */
    async pushCurrentBranch(): Promise<{ success: boolean; error?: string }> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return { success: false, error: 'No workspace folder' };
        }

        try {
            const branchName = await this.getCurrentBranch();
            if (!branchName) {
                return { success: false, error: 'Not on a branch' };
            }

            await execAsync(`git push -u origin "${branchName}"`, { cwd });

            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Check if a branch exists locally.
     */
    async branchExists(branchName: string): Promise<boolean> {
        const branches = await this.getLocalBranches();
        return branches.includes(branchName);
    }

    /**
     * Check if a branch exists on remote.
     */
    async remoteBranchExists(branchName: string): Promise<boolean> {
        const branches = await this.getRemoteBranches();
        return branches.includes(branchName);
    }

    /**
     * Switch to a branch (handles both local and remote branches).
     * Includes VSCode-specific UI for uncommitted changes.
     */
    async switchToBranch(branchName: string): Promise<{ success: boolean; error?: string }> {
        const cwd = getWorkspacePath();
        if (!cwd) {
            return { success: false, error: 'No workspace folder open' };
        }

        try {
            // Check for uncommitted changes using core utility
            const uncommitted = await hasUncommittedChanges();

            if (uncommitted) {
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
                    await execAsync('git stash push -m "Auto-stash before switching to ' + branchName + '"', { cwd });
                }
            }

            // Check if branch exists locally
            const localBranches = await this.getLocalBranches();
            const existsLocally = localBranches.includes(branchName);

            if (existsLocally) {
                // Simple checkout
                await execAsync(`git checkout "${branchName}"`, { cwd });
            } else {
                // Check if it exists on remote
                const remoteBranches = await this.getRemoteBranches();
                const existsRemotely = remoteBranches.includes(branchName);

                if (existsRemotely) {
                    // Create local tracking branch from remote
                    await execAsync(`git checkout -b "${branchName}" "origin/${branchName}"`, { cwd });
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
