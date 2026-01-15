import * as vscode from 'vscode';
import { GitHubAPI } from './github-api';
import { ProjectBoardProvider, ItemNode } from './tree-provider';
import { detectRepository, type RepoInfo } from './repo-detector';
import { StatusBarManager, showAccessHelp } from './status-bar';
import { executeStartWorking } from './start-working';

let api: GitHubAPI;
let boardProvider: ProjectBoardProvider;
let statusBar: StatusBarManager;
let currentRepo: RepoInfo | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('GitHub Projects extension is now active');

    // Initialize components
    api = new GitHubAPI();
    boardProvider = new ProjectBoardProvider(api);
    statusBar = new StatusBarManager();
    statusBar.show();

    // Register tree view - single unified view showing project boards
    const boardView = vscode.window.createTreeView('ghProjects.board', {
        treeDataProvider: boardProvider,
        showCollapseAll: true,
    });

    context.subscriptions.push(boardView, statusBar);

    // Register commands
    registerCommands(context);

    // Listen for workspace changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await loadProjects();
        }),
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('ghProjects')) {
                boardProvider.refresh();
            }
        })
    );

    // Initialize on startup
    await initialize();
}

function registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.signIn', async () => {
            const success = await api.authenticate();
            if (success) {
                vscode.window.showInformationMessage(`Signed in as ${api.username}`);
                await loadProjects();
            } else {
                vscode.window.showErrorMessage('Failed to sign in to GitHub');
            }
        }),

        vscode.commands.registerCommand('ghProjects.refresh', async () => {
            await loadProjects();
        }),

        vscode.commands.registerCommand('ghProjects.openItem', async (url: string) => {
            if (url) {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }),

        vscode.commands.registerCommand('ghProjects.showAccessHelp', showAccessHelp),

        vscode.commands.registerCommand('ghProjects.configureProject', async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'ghProjects');
        }),

        vscode.commands.registerCommand('ghProjects.openProjectInBrowser', async (url: string) => {
            if (url) {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }),

        vscode.commands.registerCommand('ghProjects.startWorking', async (node: unknown) => {
            // The node comes from the tree view context menu
            if (node instanceof ItemNode) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Starting work...',
                        cancellable: false,
                    },
                    async () => {
                        const success = await executeStartWorking(api, {
                            item: node.item,
                            project: node.project,
                        });

                        if (success) {
                            // Refresh to show updated status
                            boardProvider.refresh();
                        }
                    }
                );
            } else {
                vscode.window.showErrorMessage('Please select an issue or PR to start working on');
            }
        })
    );
}

async function initialize() {
    statusBar.setLoading();

    const success = await api.authenticate();
    if (success) {
        await loadProjects();
    } else {
        statusBar.setError('Sign in required');
        boardProvider.refresh();
    }
}

async function loadProjects() {
    statusBar.setLoading();
    boardProvider.setLoading(true);

    // Detect current repository
    currentRepo = await detectRepository();

    if (!currentRepo) {
        statusBar.setNoRepo();
        boardProvider.setLoading(false);
        await boardProvider.setProjects([]);
        return;
    }

    if (!api.isAuthenticated) {
        statusBar.setError('Sign in required');
        boardProvider.setLoading(false);
        return;
    }

    try {
        // Fetch projects with their views
        const projects = await api.getProjectsWithViews(currentRepo);

        await boardProvider.setProjects(projects);
        boardProvider.setLoading(false);

        if (projects.length === 0) {
            statusBar.setNoProjects(currentRepo);
        } else {
            statusBar.setConnected(currentRepo, projects.length);
        }
    } catch (error) {
        console.error('Failed to load projects:', error);
        statusBar.setError('Failed to load projects');
        boardProvider.setLoading(false);
    }
}

export function deactivate() {
    // Cleanup
}
