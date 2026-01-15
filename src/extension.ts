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

        vscode.commands.registerCommand('ghProjects.debugAuth', async () => {
            // Debug command to help diagnose authentication issues
            const output = vscode.window.createOutputChannel('GitHub Projects Debug');
            output.show();
            output.appendLine('=== GitHub Projects Authentication Debug ===\n');

            try {
                const session = await vscode.authentication.getSession('github', ['read:project', 'repo'], {
                    createIfNone: false,
                });

                if (!session) {
                    output.appendLine('❌ No GitHub session found. Please sign in first.');
                    return;
                }

                output.appendLine(`✅ Authenticated as: ${session.account.label}`);
                output.appendLine(`   Scopes requested: read:project, repo`);
                output.appendLine(`   Session ID: ${session.id.substring(0, 8)}...`);
                output.appendLine('');

                // Test basic API access
                const { graphql } = await import('@octokit/graphql');
                const client = graphql.defaults({
                    headers: { authorization: `token ${session.accessToken}` },
                });

                // Test viewer query
                const viewerResult = await client<{ viewer: { login: string; organizations: { nodes: Array<{ login: string }> } } }>(`
                    query {
                        viewer {
                            login
                            organizations(first: 10) {
                                nodes {
                                    login
                                }
                            }
                        }
                    }
                `);
                output.appendLine(`✅ API connection works`);
                output.appendLine(`   User: ${viewerResult.viewer.login}`);
                output.appendLine(`   Visible orgs: ${viewerResult.viewer.organizations.nodes.map(o => o.login).join(', ') || 'none'}`);
                output.appendLine('');

                // Test current repo
                const repo = await detectRepository();
                if (repo) {
                    output.appendLine(`📁 Current repository: ${repo.fullName}`);
                    output.appendLine('');

                    // Try to access repo projects
                    try {
                        const repoResult = await client<{ repository: { projectsV2: { totalCount: number } } }>(`
                            query($owner: String!, $name: String!) {
                                repository(owner: $owner, name: $name) {
                                    projectsV2(first: 1) {
                                        totalCount
                                    }
                                }
                            }
                        `, { owner: repo.owner, name: repo.name });
                        output.appendLine(`✅ Repo projects access: ${repoResult.repository.projectsV2.totalCount} projects found`);
                    } catch (e) {
                        output.appendLine(`❌ Repo projects access failed: ${e instanceof Error ? e.message : String(e)}`);
                        output.appendLine('');
                        output.appendLine('💡 If this is an org repo with SSO, you may need to authorize the token:');
                        output.appendLine('   1. Go to github.com/settings/connections/applications');
                        output.appendLine('   2. Find "Visual Studio Code" or "Cursor"');
                        output.appendLine('   3. Click "Configure" and authorize for your organization');
                    }

                    // Try org projects if owner looks like an org
                    try {
                        const orgResult = await client<{ organization: { projectsV2: { totalCount: number } } }>(`
                            query($owner: String!) {
                                organization(login: $owner) {
                                    projectsV2(first: 1) {
                                        totalCount
                                    }
                                }
                            }
                        `, { owner: repo.owner });
                        output.appendLine(`✅ Org projects access (${repo.owner}): ${orgResult.organization.projectsV2.totalCount} projects found`);
                    } catch (e) {
                        const errorMsg = e instanceof Error ? e.message : String(e);
                        if (errorMsg.includes('Could not resolve to an Organization')) {
                            output.appendLine(`ℹ️  ${repo.owner} is not an organization (user account)`);
                        } else {
                            output.appendLine(`❌ Org projects access failed: ${errorMsg}`);
                        }
                    }
                } else {
                    output.appendLine('ℹ️  No git repository detected in current workspace');
                }

            } catch (e) {
                output.appendLine(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
            }

            output.appendLine('\n=== End Debug ===');
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
        boardProvider.setLoading(false);

        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check for SSO-related errors and offer to help
        if (errorMessage.includes('SSO Authorization Required')) {
            statusBar.setError('SSO authorization required');
            const action = await vscode.window.showErrorMessage(
                errorMessage,
                'Open GitHub Settings',
                'Re-authenticate'
            );
            if (action === 'Open GitHub Settings') {
                await vscode.env.openExternal(
                    vscode.Uri.parse('https://github.com/settings/connections/applications')
                );
            } else if (action === 'Re-authenticate') {
                // Clear the session and try again
                await vscode.commands.executeCommand('ghProjects.signIn');
            }
        } else {
            statusBar.setError('Failed to load projects');
            vscode.window.showErrorMessage(`GitHub Projects: ${errorMessage}`);
        }
    }
}

export function deactivate() {
    // Cleanup
}
